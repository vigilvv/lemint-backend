import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import "dotenv/config";

const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_API_KEY = process.env.PINATA_SECRET_API_KEY;

//=================================================

export const uploadToIPFS = async (fileData: string, fileName: string) => {
  try {
    const formData = new FormData();

    // Convert base64 to buffer
    const buffer = Buffer.from(fileData, "base64");

    // Add file to form data
    formData.append("file", buffer, {
      filename: fileName,
      contentType: "image/png",
    });

    // Add pinata metadata
    const metadata = JSON.stringify({
      name: fileName,
    });
    formData.append("pinataMetadata", metadata);

    // Add pinata options
    const options = JSON.stringify({
      cidVersion: 0,
    });
    formData.append("pinataOptions", options);

    const response = await axios.post(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      formData,
      {
        headers: {
          "Content-Type": `multipart/form-data; boundary=${formData.getBoundary()}`,
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET_API_KEY,
        },
      }
    );

    return {
      ipfsHash: response.data.IpfsHash,
      ipfsUrl: `https://gateway.pinata.cloud/ipfs/${response.data.IpfsHash}`,
    };
  } catch (error) {
    console.error("Error uploading to IPFS:", error);
    throw error;
  }
};

//=================================================

export const uploadMetadataToIPFS = async (
  metadata: object,
  fileName: string
) => {
  try {
    const formData = new FormData();

    // Create a buffer of the metadata JSON
    const metadataBuffer = Buffer.from(JSON.stringify(metadata), "utf8");

    // Append the metadata file
    formData.append("file", metadataBuffer, {
      filename: `${fileName}.json`,
      contentType: "application/json",
    });

    // Add Pinata metadata
    const pinataMetadata = JSON.stringify({ name: `${fileName}-metadata` });
    formData.append("pinataMetadata", pinataMetadata);

    // Add Pinata options
    const options = JSON.stringify({ cidVersion: 0 });
    formData.append("pinataOptions", options);

    const response = await axios.post(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      formData,
      {
        headers: {
          "Content-Type": `multipart/form-data; boundary=${formData.getBoundary()}`,
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET_API_KEY,
        },
      }
    );

    return {
      ipfsHash: response.data.IpfsHash,
      ipfsUri: `ipfs://${response.data.IpfsHash}`,
      pinataUrl: `https://gateway.pinata.cloud/ipfs/${response.data.IpfsHash}`,
    };
  } catch (error) {
    console.error("Error uploading metadata to IPFS:", error);
    throw error;
  }
};
