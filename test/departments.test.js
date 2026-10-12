import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_DEPARTMENTS,
  DEFAULT_DEPARTMENTS,
  normalizeDepartmentSelection
} from "../src/departments.js";

test("all department options match the 97 source units", () => {
  assert.equal(ALL_DEPARTMENTS.length, 97);
  assert.equal(new Set(ALL_DEPARTMENTS).size, 97);
  assert.equal(ALL_DEPARTMENTS[0], "党政办公室");
  assert.equal(ALL_DEPARTMENTS[52], "物理与光电工程学院");
  assert.equal(ALL_DEPARTMENTS.at(-1), "深圳大学医院管理委员会");
});

test("default selection remains the original five units", () => {
  assert.deepEqual(DEFAULT_DEPARTMENTS, [
    "校团委",
    "教务部",
    "学生部",
    "时光学生社区管理委员会",
    "物理与光电工程学院"
  ]);
});

test("department normalization validates, de-duplicates, and preserves order", () => {
  assert.deepEqual(
    normalizeDepartmentSelection(["教务部", "不存在单位", "教务部", "学生部"]),
    ["教务部", "学生部"]
  );
  assert.deepEqual(normalizeDepartmentSelection([]), DEFAULT_DEPARTMENTS);
});
