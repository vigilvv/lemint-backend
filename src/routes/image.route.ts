import express from "express";
import { generateImage } from "../services/openai.service";
import { uploadToIPFS } from "../services/pinata.service";

const router = express.Router();

router.post("/generate-image", async (req, res): Promise<any> => {
  try {
    const { prompt } = req.body;

    console.log("Prompt: ", prompt);

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const imageData = await generateImage(prompt);
    res.json({ imageData });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate image" });
  }
});

// For testing
router.post("/save-to-ipfs", async (req, res): Promise<any> => {
  try {
    console.log("Uploading to Pinata");
    const { imageData, fileName } = req.body;

    if (!imageData || !fileName) {
      return res
        .status(400)
        .json({ error: "Image data and file name are required" });
    }

    // Remove the data URL prefix if present
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");

    const result = await uploadToIPFS(base64Data, fileName);
    console.log("Pinata upload result: ", result);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to save image to IPFS" });
  }
});

export default router;
