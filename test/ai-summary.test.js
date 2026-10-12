import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("AI summary uses the OpenAI-compatible endpoint and validates bullets", async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      requests.push(payload);
      const title = payload.messages.at(-1).content;
      const content = title.includes("invalid")
        ? "not-json"
        : JSON.stringify({
            bullets: ["第一条 AI 要点", "第二条 AI 要点"]
          });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { content } }]
        })
      );
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "test-model";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;

  try {
    const { buildAiSummary } = await import(`../src/summarize.js?ai-test=${Date.now()}`);
    const result = await buildAiSummary({
      title: "正常通知",
      text: "通知正文"
    });
    const invalid = await buildAiSummary({
      title: "invalid",
      text: "通知正文"
    });

    assert.deepEqual(result, ["第一条 AI 要点", "第二条 AI 要点"]);
    assert.equal(invalid, null);
    assert.equal(requests[0].messages[0].content.includes("一到两句话"), true);
    assert.equal(requests[0].messages[0].content.includes("核心事件"), true);
  } finally {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_BASE_URL;
    await new Promise((resolve) => server.close(resolve));
  }
});
