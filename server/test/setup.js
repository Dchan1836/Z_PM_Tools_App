// Test processes never talk to OpenAI. A passed-in mock client is the only model.
delete process.env.OPENAI_API_KEY;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input || "");
  if (/openai\.com/i.test(url)) {
    throw new Error("Refusing a test call to OpenAI. Pass createMockLlm() instead.");
  }
  if (typeof originalFetch === "function") return originalFetch(input, init);
  throw new Error(`Unexpected network call to ${url || "an empty URL"}.`);
};
