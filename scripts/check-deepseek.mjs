import { buildAiSummary } from "../src/summarize.js";

const bullets = await buildAiSummary({
  title: "奖学金申请提醒",
  text:
    "各学院请注意，学生须在2026年9月30日前提交奖学金申请及相关证明材料。逾期提交将不再受理，请同学们合理安排时间并尽快完成申请。"
});

console.log(JSON.stringify(bullets, null, 2));
