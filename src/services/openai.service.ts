import OpenAI from "openai";
import "dotenv/config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const generateImage = async (prompt: string) => {
  try {
    const response = await openai.images.generate({
      model: "gpt-image-1", // or "dall-e-2"
      prompt: prompt,
      n: 1,
      size: "1024x1024", // for dall-e-3, only 1024x1024, 1024x1792 or 1792x1024
      quality: "low", // high, medium and low are supported for gpt-image-1
    });

    if (!response.data) {
      throw new Error("Error generating image.");
    }

    // console.log("image url: ", response.data[0].b64_json);
    return response.data[0].b64_json;
  } catch (error) {
    console.error("Error generating image:", error);
    throw error;
  }
};
