const CONVEX_URL = process.env.CONVEX_URL;
const SLACK_WEBHOOK_URL = process.env.SLACK_MEET_WEBHOOK_URL;

if (!CONVEX_URL) {
  console.error("Missing CONVEX_URL. Exiting.");
  process.exit(1);
}

if (!SLACK_WEBHOOK_URL) {
  console.error("Missing SLACK_MEET_WEBHOOK_URL. Exiting.");
  process.exit(1);
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function formatMeetDate(meet) {
  if (!meet.endDate || meet.endDate === meet.startDate) {
    return meet.startDate;
  }

  return `${meet.startDate} to ${meet.endDate}`;
}

async function queryConvex(path, args = {}) {
  const response = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args }),
  });

  if (!response.ok) {
    throw new Error(`Convex query failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  if (result.status === "error") {
    throw new Error(`Convex query failed: ${result.errorMessage ?? "unknown error"}`);
  }

  return result.value ?? result;
}

async function sendSlackMessage(text) {
  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  const today = new Date();
  const todayKey = toDateKey(today);
  const cutoffKey = toDateKey(addMonths(today, 2));

  const meets = await queryConvex("meets:listAll");
  if (!Array.isArray(meets)) {
    throw new Error("Convex query did not return a meets array.");
  }

  const upcomingMeets = meets
    .filter((meet) => {
      return (
        meet.status !== "completed" &&
        meet.startDate >= todayKey &&
        meet.startDate <= cutoffKey
      );
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));

  const header = `Upcoming meets from ${todayKey} through ${cutoffKey}`;
  const message =
    upcomingMeets.length === 0
      ? `${header}\n\nNo meets found.`
      : `${header}\n\n${upcomingMeets
          .map((meet) => `- ${meet.name}: ${formatMeetDate(meet)}`)
          .join("\n")}`;

  await sendSlackMessage(message);
  console.log(`Sent ${upcomingMeets.length} upcoming meet(s) to Slack.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
