/**
 * Shared JSDoc types for the plan returned by POST /api/plan.
 * Type-only module: it exports nothing at runtime.
 * @module types
 */

/**
 * @typedef {object} BudgetLine
 * @property {string} category
 * @property {string} label
 * @property {number} amount
 * @property {number} percent
 * @property {boolean} prioritized
 */

/**
 * @typedef {object} Budget
 * @property {number} total
 * @property {string} currency
 * @property {number} perGuest
 * @property {BudgetLine[]} lines
 */

/**
 * @typedef {object} TimelineTask
 * @property {string} id
 * @property {string} text
 * @property {string} dueDate
 * @property {boolean} urgent
 * @property {'template' | 'ai'} source
 */

/** @typedef {{ phase: string, tasks: TimelineTask[] }} TimelinePhase */

/**
 * @typedef {object} VendorItem
 * @property {string} id
 * @property {string} vendor
 * @property {string} bookBy
 * @property {boolean} urgent
 * @property {string[]} questions
 * @property {string} tip
 */

/** @typedef {{ title: string, description: string, category: string }} Idea */

/**
 * @typedef {object} Plan
 * @property {{ type: string, name: string, date: string, daysUntil: number, guestCount: number, city: string, theme: string }} event
 * @property {string} summary
 * @property {Budget} budget
 * @property {TimelinePhase[]} timeline
 * @property {VendorItem[]} checklist
 * @property {Idea[]} ideas
 * @property {string[]} budgetTips
 * @property {string[]} risks
 * @property {'gemini' | 'fallback'} source
 */

/** @typedef {Record<string, boolean>} Progress checkbox id → done */

export {};
