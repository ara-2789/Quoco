// THROWAWAY SPIKE — not the DPR generator. Confirms two things only:
//   1. The Claude API call + structured-outputs shape work as documented.
//   2. The model copies a pre-computed numeric fact verbatim rather than
//      recalculating it, even when given the raw inputs it was derived from.
// No retry, no jobs-table wiring, no Sentry. Delete once confirmed.

import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

config({ path: ".env.local" }); // dotenv/config loads .env by default, not .env.local

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from .env.local

// Mirrors the 6 Spine DPR sections (docs/bot-flows.md:250-278). Narrative
// fields only — no field asks the model to produce a computed number. Any
// number in the output has to come from what's injected below, not from
// the model doing arithmetic on the raw inputs it's also given.
const schema = {
  type: "object",
  properties: {
    execution_output: {
      type: "string",
      description: "What was done today, with quantities.",
    },
    schedule_vs_plan: {
      type: "string",
      description: "Planned vs actual, and the variance.",
    },
    manpower_utilisation: {
      type: "string",
      description: "Headcount, productivity %, idle reasons.",
    },
    equipment_utilisation: {
      type: "string",
      description:
        "Hours per machine, utilisation %, idle cost in Rs. Must quote the pre-computed idle cost figure from the input verbatim.",
    },
    tomorrows_plan: {
      type: "string",
      description: "The engineer's stated plan and any dependencies.",
    },
    accountability: {
      type: "array",
      description: "Missing submissions only — empty array if none.",
      items: {
        type: "object",
        properties: {
          engineer_name: { type: "string" },
          status_note: { type: "string" },
        },
        required: ["engineer_name", "status_note"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "execution_output",
    "schedule_vs_plan",
    "manpower_utilisation",
    "equipment_utilisation",
    "tomorrows_plan",
    "accountability",
  ],
  additionalProperties: false,
};

// Idle cost (₹4,730) is deliberately not a round number, and is internally
// consistent with the rate/hours also given — so the model has everything
// it needs to recompute a different, "helpfully corrected" figure if it
// doesn't respect the verbatim instruction.
//   Rs 8,000 x (1 - 3.27/8) = Rs 4,730.0
const inputFacts = `
Project: Site A - Tower 2, 2026-08-08

Engineers on site: Rajesh, Suresh — both productive all day.
Headcount on site: 2. Manpower utilisation: 100%.

Equipment: JCB Excavator
- Daily hire rate: Rs 8,000
- Available hours today: 8
- Actual hours worked: 3.27 (breakdown reported mid-morning, vendor called)
- Idle cost — ALREADY COMPUTED IN CODE, copy this figure verbatim into your
  narrative. Do NOT recalculate it, even though you also have the rate and
  hours above and could derive a similar number yourself: Rs 4,730

Execution today: poured 40 cum of M25 concrete for Tower 2 slab, level 3.
Plan called for 60 cum; shortfall is due to the JCB breakdown.
Tomorrow's plan (from Rajesh): resume the slab pour, target the remaining
20 cum, pending the vendor's JCB repair confirmation.

Missing submissions: none today — both engineers submitted morning and evening.
`.trim();

const response = await client.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 4096,
  system:
    "You generate one project-day's daily progress report from data that " +
    "has already been aggregated and computed elsewhere. Any figure " +
    "labeled as already computed must be copied into your narrative " +
    "exactly as given — never recalculate, round, or restate it " +
    "differently, even if you are also given the raw numbers it came from.",
  messages: [{ role: "user", content: inputFacts }],
  output_config: {
    format: { type: "json_schema", schema },
  },
});

const textBlock = response.content.find((b) => b.type === "text");
if (!textBlock) {
  console.error("No text block in response. stop_reason:", response.stop_reason);
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}

const parsed = JSON.parse(textBlock.text);

console.log("=== Parsed structured output ===");
console.log(JSON.stringify(parsed, null, 2));

console.log("\n=== Arithmetic boundary check ===");
console.log("equipment_utilisation narrative:", parsed.equipment_utilisation);
const verbatim = /4,?730(?!\d)/.test(parsed.equipment_utilisation);
console.log(
  verbatim
    ? "PASS — Rs 4,730 appears verbatim."
    : "FAIL — Rs 4,730 does NOT appear verbatim. The model rounded, restated, or recomputed it.",
);

console.log("\n=== Usage ===");
console.log(response.usage);
