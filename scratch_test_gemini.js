const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const stream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'My child is struggling with a subject. How can you help?' }] }],
      config: {
        maxOutputTokens: 250,
        temperature: 0.1,
        topP: 0.8,
      }
    });
    for await (const chunk of stream) {
      console.log('CHUNK OBJECT:', JSON.stringify(chunk, null, 2));
      console.log('CHUNK TEXT:', chunk.text);
    }
  } catch (e) {
    console.error('ERROR:', e);
  }
}
run();
