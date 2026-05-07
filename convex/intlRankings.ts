import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

type IntlRankingInput = {
  legacyId?: number;
  meet?: string;
  ranking?: number;
  name?: string;
  weightClass?: string;
  total?: number;
  percentA?: number;
  gender?: string;
  ageCategory?: string;
};

// Get all international rankings
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("intl_rankings").collect();
  },
});

// Get rankings filtered by gender, age category, or meet
export const getFiltered = query({
  args: {
    gender: v.optional(v.string()),
    ageCategory: v.optional(v.string()),
    meet: v.optional(v.string()),
  },
  handler: async (ctx, { gender, ageCategory, meet }) => {
    if (gender && ageCategory) {
      const rows = await ctx.db
        .query("intl_rankings")
        .withIndex("by_gender_age", (q) =>
          q.eq("gender", gender).eq("ageCategory", ageCategory)
        )
        .collect();
      return meet ? rows.filter((r) => r.meet === meet) : rows;
    }

    let rows = await ctx.db.query("intl_rankings").collect();
    if (gender) rows = rows.filter((r) => r.gender?.toLowerCase() === gender.toLowerCase());
    if (ageCategory) rows = rows.filter((r) => r.ageCategory === ageCategory);
    if (meet) rows = rows.filter((r) => r.meet === meet);
    return rows;
  },
});

// Upsert an international ranking (used by rankings scraper)
export const upsertIntlRanking = internalMutation({
  args: {
    legacyId: v.optional(v.number()),
    meet: v.optional(v.string()),
    ranking: v.optional(v.number()),
    name: v.optional(v.string()),
    weightClass: v.optional(v.string()),
    total: v.optional(v.number()),
    percentA: v.optional(v.number()),
    gender: v.optional(v.string()),
    ageCategory: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Deduplication: use legacyId if present, else insert fresh
    if (args.legacyId != null) {
      const existing = await ctx.db
        .query("intl_rankings")
        .filter((q) => q.eq(q.field("legacyId"), args.legacyId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, args);
        return { id: existing._id, wasInsert: false };
      }
    }
    const id = await ctx.db.insert("intl_rankings", args);
    return { id, wasInsert: true };
  },
});

// Delete all intl rankings (for bulk replace)
export const deleteAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("intl_rankings").collect();
    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});

// Delete rankings for a specific meet + gender + age category group
export const deleteByMeetGenderAge = internalMutation({
  args: {
    meet: v.string(),
    gender: v.string(),
    ageCategory: v.string(),
  },
  handler: async (ctx, { meet, gender, ageCategory }) => {
    const rows = await ctx.db
      .query("intl_rankings")
      .withIndex("by_gender_age", (q) =>
        q.eq("gender", gender).eq("ageCategory", ageCategory)
      )
      .collect();

    const toDelete = rows.filter((r) => r.meet === meet);
    await Promise.all(toDelete.map((r) => ctx.db.delete(r._id)));
    return toDelete.length;
  },
});

// Differential upsert for a specific meet + gender + age category group.
// Uses ranking as the stable row key within the group.
export const replaceByMeetGenderAge = internalMutation({
  args: {
    meet: v.string(),
    gender: v.string(),
    ageCategory: v.string(),
    rankings: v.array(
      v.object({
        legacyId: v.optional(v.number()),
        meet: v.optional(v.string()),
        ranking: v.optional(v.number()),
        name: v.optional(v.string()),
        weightClass: v.optional(v.string()),
        total: v.optional(v.number()),
        percentA: v.optional(v.number()),
        gender: v.optional(v.string()),
        ageCategory: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const existingRows = await ctx.db
      .query("intl_rankings")
      .withIndex("by_gender_age", (q) =>
        q.eq("gender", args.gender).eq("ageCategory", args.ageCategory)
      )
      .collect();
    const groupRows = existingRows.filter((r) => r.meet === args.meet);

    const existingByRanking = new Map<number, (typeof groupRows)[number]>();
    for (const row of groupRows) {
      if (row.ranking != null) existingByRanking.set(row.ranking, row);
    }

    const incomingRankings = new Set<number>();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const ranking of args.rankings) {
      if (ranking.ranking == null) {
        await ctx.db.insert("intl_rankings", ranking);
        inserted++;
        continue;
      }

      incomingRankings.add(ranking.ranking);
      const existing = existingByRanking.get(ranking.ranking);
      if (!existing) {
        await ctx.db.insert("intl_rankings", ranking);
        inserted++;
        continue;
      }

      if (intlRankingChanged(existing, ranking)) {
        await ctx.db.patch(existing._id, ranking);
        updated++;
      } else {
        unchanged++;
      }
    }

    let deleted = 0;
    for (const row of groupRows) {
      if (row.ranking == null || !incomingRankings.has(row.ranking)) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }

    return { inserted, updated, unchanged, deleted };
  },
});

function intlRankingChanged(
  existing: IntlRankingInput,
  incoming: IntlRankingInput
): boolean {
  return (
    existing.legacyId !== incoming.legacyId ||
    existing.meet !== incoming.meet ||
    existing.ranking !== incoming.ranking ||
    existing.name !== incoming.name ||
    existing.weightClass !== incoming.weightClass ||
    existing.total !== incoming.total ||
    existing.percentA !== incoming.percentA ||
    existing.gender !== incoming.gender ||
    existing.ageCategory !== incoming.ageCategory
  );
}

export const deleteGroupsNotIn = internalMutation({
  args: {
    groups: v.array(
      v.object({
        meet: v.string(),
        gender: v.string(),
        ageCategory: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const activeGroups = new Set(
      args.groups.map((group) => groupKey(group.meet, group.gender, group.ageCategory))
    );
    const rows = await ctx.db.query("intl_rankings").collect();
    const deletedByGroup = new Map<string, {
      meet: string;
      gender: string;
      ageCategory: string;
      deleted: number;
    }>();

    for (const row of rows) {
      if (!row.meet || !row.gender || !row.ageCategory) continue;

      const key = groupKey(row.meet, row.gender, row.ageCategory);
      if (activeGroups.has(key)) continue;

      await ctx.db.delete(row._id);
      const existing = deletedByGroup.get(key) ?? {
        meet: row.meet,
        gender: row.gender,
        ageCategory: row.ageCategory,
        deleted: 0,
      };
      existing.deleted++;
      deletedByGroup.set(key, existing);
    }

    return { deletedGroups: Array.from(deletedByGroup.values()) };
  },
});

function groupKey(meet: string, gender: string, ageCategory: string): string {
  return `${meet}::${gender}::${ageCategory}`;
}
