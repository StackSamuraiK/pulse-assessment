import 'dotenv/config';

async function list() {
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  const response = await ai.models.list(); // Wait, the method might be listModels()? Or maybe we can just catch the error.
  for await (const model of response) {
    if (model.name?.includes('embed')) {
      console.log(model.name);
    }
  }
}
list().catch(console.error);
