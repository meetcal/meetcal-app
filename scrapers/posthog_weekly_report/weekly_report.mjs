#!/usr/bin/env bun

const DEFAULT_POSTHOG_BASE_URL = 'https://app.posthog.com';
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3-flash-preview';

function getEnv(name, options = {}) {
  const value = process.env[name]?.trim();
  if (!value && options.required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || options.defaultValue;
}

async function requestJson(url, init, label) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} failed (${response.status}): ${body.slice(0, 500)}`);
  }
  return response.json();
}

function extractRows(queryResponse) {
  if (Array.isArray(queryResponse?.results)) {
    return queryResponse.results;
  }
  if (Array.isArray(queryResponse?.result)) {
    return queryResponse.result;
  }
  if (Array.isArray(queryResponse?.data)) {
    return queryResponse.data;
  }
  return [];
}

async function posthogGet(path, posthogBaseUrl, posthogApiKey) {
  const url = `${posthogBaseUrl}${path}`;
  return requestJson(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${posthogApiKey}`,
        'Content-Type': 'application/json',
      },
    },
    `PostHog GET ${path}`,
  );
}

async function posthogQuery(hogql, posthogBaseUrl, posthogApiKey, projectId) {
  const path = `/api/projects/${projectId}/query/`;
  const url = `${posthogBaseUrl}${path}`;

  return requestJson(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${posthogApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query: hogql,
        },
      }),
    },
    `PostHog query ${path}`,
  );
}

async function fetchDashboardPayload({ posthogBaseUrl, posthogApiKey, projectId, dashboardIds }) {
  if (dashboardIds.length > 0) {
    const dashboards = await Promise.all(
      dashboardIds.map((id) =>
        posthogGet(`/api/projects/${projectId}/dashboards/${id}/`, posthogBaseUrl, posthogApiKey)
          .then((dashboard) => ({
            id: dashboard.id,
            name: dashboard.name,
            description: dashboard.description ?? null,
            tiles: Array.isArray(dashboard.tiles)
              ? dashboard.tiles.map((tile) => ({
                  id: tile.id,
                  insight_id: tile.insight?.id ?? null,
                  insight_name: tile.insight?.name ?? null,
                }))
              : [],
          })),
      ),
    );

    return { source: 'explicit_dashboard_ids', dashboards };
  }

  const listResponse = await posthogGet(
    `/api/projects/${projectId}/dashboards/?limit=10`,
    posthogBaseUrl,
    posthogApiKey,
  );

  const list = Array.isArray(listResponse.results) ? listResponse.results : [];
  const topIds = list.slice(0, 5).map((dashboard) => dashboard.id).filter(Boolean);

  const dashboards = await Promise.all(
    topIds.map((id) =>
      posthogGet(`/api/projects/${projectId}/dashboards/${id}/`, posthogBaseUrl, posthogApiKey)
        .then((dashboard) => ({
          id: dashboard.id,
          name: dashboard.name,
          description: dashboard.description ?? null,
          tiles: Array.isArray(dashboard.tiles)
            ? dashboard.tiles.map((tile) => ({
                id: tile.id,
                insight_id: tile.insight?.id ?? null,
                insight_name: tile.insight?.name ?? null,
              }))
            : [],
        })),
    ),
  );

  return { source: 'top_5_dashboards', dashboards };
}

async function fetchPerformancePayload({ posthogBaseUrl, posthogApiKey, projectId }) {
  const topEventsQuery = `
WITH
  current_week AS (
    SELECT event, count() AS current_count
    FROM events
    WHERE timestamp >= now() - INTERVAL 7 DAY
    GROUP BY event
  ),
  previous_week AS (
    SELECT event, count() AS previous_count
    FROM events
    WHERE timestamp >= now() - INTERVAL 14 DAY
      AND timestamp < now() - INTERVAL 7 DAY
    GROUP BY event
  )
SELECT
  cw.event,
  cw.current_count,
  coalesce(pw.previous_count, 0) AS previous_count,
  cw.current_count - coalesce(pw.previous_count, 0) AS delta
FROM current_week cw
LEFT JOIN previous_week pw ON cw.event = pw.event
ORDER BY cw.current_count DESC
LIMIT 15
`;

  const activeUsersQuery = `
SELECT
  toDate(timestamp) AS day,
  uniq(distinct_id) AS active_users,
  count() AS events
FROM events
WHERE timestamp >= now() - INTERVAL 14 DAY
GROUP BY day
ORDER BY day ASC
`;

  const performanceSignalsQuery = `
WITH
  current_week AS (
    SELECT event, count() AS current_count
    FROM events
    WHERE timestamp >= now() - INTERVAL 7 DAY
      AND (
        lower(event) LIKE '%perf%'
        OR lower(event) LIKE '%latency%'
        OR lower(event) LIKE '%load%'
        OR lower(event) LIKE '%error%'
        OR lower(event) LIKE '%exception%'
        OR lower(event) LIKE '%crash%'
      )
    GROUP BY event
  ),
  previous_week AS (
    SELECT event, count() AS previous_count
    FROM events
    WHERE timestamp >= now() - INTERVAL 14 DAY
      AND timestamp < now() - INTERVAL 7 DAY
      AND (
        lower(event) LIKE '%perf%'
        OR lower(event) LIKE '%latency%'
        OR lower(event) LIKE '%load%'
        OR lower(event) LIKE '%error%'
        OR lower(event) LIKE '%exception%'
        OR lower(event) LIKE '%crash%'
      )
    GROUP BY event
  )
SELECT
  cw.event,
  cw.current_count,
  coalesce(pw.previous_count, 0) AS previous_count,
  cw.current_count - coalesce(pw.previous_count, 0) AS delta
FROM current_week cw
LEFT JOIN previous_week pw ON cw.event = pw.event
ORDER BY abs(delta) DESC, cw.current_count DESC
LIMIT 20
`;

  const [topEventsRes, activeUsersRes, performanceSignalsRes] = await Promise.all([
    posthogQuery(topEventsQuery, posthogBaseUrl, posthogApiKey, projectId),
    posthogQuery(activeUsersQuery, posthogBaseUrl, posthogApiKey, projectId),
    posthogQuery(performanceSignalsQuery, posthogBaseUrl, posthogApiKey, projectId),
  ]);

  return {
    top_events_week_over_week: extractRows(topEventsRes),
    daily_active_users_last_14_days: extractRows(activeUsersRes),
    app_performance_signals_week_over_week: extractRows(performanceSignalsRes),
  };
}

async function analyzeWithOpenRouter({ openrouterApiKey, openrouterModel, payload }) {
  const today = new Date().toISOString().slice(0, 10);

  const response = await requestJson(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openrouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openrouterModel,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a product analytics expert. Create concise weekly reports for executives and engineers. Use only the provided data. If data is missing, say so clearly. Output text with sections: Executive Summary, Dashboard Highlights, App Performance, Risks, Recommended Actions. The data is from an app MeetCal. MeetCal is an all-in-one platform for Olympic Weightlifting that brings the schedule, start list, and all data revolving around a meet into one app. As such, the app is cyclical, following the seasonal structure of meets.',
          },
          {
            role: 'user',
            content: `Analyze this weekly PostHog payload for ${today}. Focus on week-over-week trend direction, anomalies, risk signals, and practical actions.\n\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
      }),
    },
    'OpenRouter completion',
  );

  const content = response?.choices?.[0]?.message?.content;

  if (typeof content === 'string' && content.trim().length > 0) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();

    if (text.length > 0) {
      return text;
    }
  }

  throw new Error('OpenRouter returned an unexpected response payload');
}

async function sendSlackReport({ slackWebhookUrl, report, posthogBaseUrl, projectId }) {
  const projectUrl = `${posthogBaseUrl}/project/${projectId}`;
  const text = `*Weekly PostHog Report*\n<${projectUrl}|Open PostHog Project>\n\n${report}`;

  const response = await fetch(slackWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${body.slice(0, 500)}`);
  }
}

async function main() {
  const posthogBaseUrl = getEnv('POSTHOG_BASE_URL', { defaultValue: DEFAULT_POSTHOG_BASE_URL });
  const projectId = getEnv('POSTHOG_PROJECT_ID', { required: true });
  const posthogApiKey = getEnv('POSTHOG_PERSONAL_API_KEY', { required: true });

  const openrouterApiKey = getEnv('OPENROUTER_API_KEY', { required: true });
  const openrouterModel = getEnv('OPENROUTER_MODEL', { defaultValue: DEFAULT_OPENROUTER_MODEL });

  const slackWebhookUrl = getEnv('SLACK_POSTHOG_WEBHOOK_URL', { required: true });
  const dashboardIdsRaw = getEnv('POSTHOG_DASHBOARD_IDS', { defaultValue: '' });
  const dashboardIds = dashboardIdsRaw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const dashboardPayload = await fetchDashboardPayload({
    posthogBaseUrl,
    posthogApiKey,
    projectId,
    dashboardIds,
  });

  const performancePayload = await fetchPerformancePayload({
    posthogBaseUrl,
    posthogApiKey,
    projectId,
  });

  const payload = {
    generated_at: new Date().toISOString(),
    posthog_project_id: projectId,
    dashboards: dashboardPayload,
    performance: performancePayload,
  };

  const report = await analyzeWithOpenRouter({
    openrouterApiKey,
    openrouterModel,
    payload,
  });

  await sendSlackReport({
    slackWebhookUrl,
    report,
    posthogBaseUrl,
    projectId,
  });

  console.log('Weekly PostHog report sent to Slack successfully.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
