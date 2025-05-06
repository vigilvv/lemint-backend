import express, { Express, Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { ethers } from "ethers";
import BasicNFTCollectionArtifacts from "../artifacts/LeMintNFTCollection.json";
import { ERC725YDataKeys } from "@lukso/lsp-smart-contracts";
import dotenv from "dotenv";
import { keccak256, toUtf8Bytes } from "ethers";

import imageRouter from "./routes/image.route";
import { uploadMetadataToIPFS, uploadToIPFS } from "./services/pinata.service";
import { ERC725 } from "@erc725/erc725.js";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

// Increase payload size limit
app.use(express.json({ limit: "10mb" })); // Default is 100kb
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Load environment variables
const PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const RPC_URL = process.env.LUKSO_RPC_URL || "https://rpc.l16.lukso.network";

if (!PRIVATE_KEY) {
  throw new Error("Please set ADMIN_PRIVATE_KEY in .env file");
}

// Initialize provider and signer
const provider = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(PRIVATE_KEY, provider);

interface MintRequest {
  recipientAddress: string;
  tokenId: number;
  metadata: {
    name: string;
    description: string;
    image: string;
    attributes?: Array<{
      trait_type: string;
      value: string;
    }>;
  };
}

// Cache for deployed contract address
let nftCollectionAddress: string | null = null;
let nftCollectionContract: ethers.Contract | null = null;

async function deployNFTCollection(metadata: any): Promise<string> {
  const contractFactory = new ethers.ContractFactory(
    BasicNFTCollectionArtifacts.abi,
    BasicNFTCollectionArtifacts.bytecode,
    adminWallet
  );

  const nftCollection = await contractFactory.deploy(
    // "LeMint AI NFT Collection", // collection name
    // "LMNFT", // collection symbol
    metadata.name,
    metadata.symbol,
    adminWallet.address // contract owner
  );

  await nftCollection.waitForDeployment();
  const address = await nftCollection.getAddress();

  console.log("NFT Collection deployed to:", address);
  return address;
}

async function getNFTCollectionContract(
  metadata: any
): Promise<ethers.Contract> {
  if (nftCollectionAddress && nftCollectionContract) {
    return nftCollectionContract;
  }

  // In production - store this address in a database/config
  nftCollectionAddress = await deployNFTCollection(metadata);
  nftCollectionContract = new ethers.Contract(
    nftCollectionAddress,
    BasicNFTCollectionArtifacts.abi,
    adminWallet
  );

  return nftCollectionContract;
}

async function mintNFT(
  recipient: string,
  tokenId: number,
  metadata: any
): Promise<any> {
  const contract = await getNFTCollectionContract(metadata);

  // Convert tokenId to bytes32
  // const tokenIdBytes32 = ethers.toBeHex(tokenId, 32);

  // Convert tokenId to proper LSP8 format (bytes32)
  const tokenIdBytes32 = ethers.zeroPadValue(ethers.toBeHex(tokenId), 32);

  console.log("Uploading image to Pinata...");
  // Upload image to IPFS via Pinata
  const imageFileName = `${metadata.name || "nft"}-${Date.now()}.png`;
  const { ipfsHash, ipfsUrl } = await uploadToIPFS(
    metadata.mediaUrl.replace(/^data:image\/\w+;base64,/, ""),
    imageFileName
  );

  console.log("ipfsHash: ", ipfsHash);

  // const imageHash = keccak256(toUtf8Bytes(`ipfs://${ipfsHash}`));

  // Remove the data URL prefix if present
  const base64Data = metadata.mediaUrl.replace(/^data:image\/\w+;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, "base64");

  const imageHash = keccak256(imageBuffer);

  // Construct LSP4 Metadata
  const lsp4Metadata = {
    // LSP4Metadata: {
    description: metadata.description,
    links: [],
    icon: [
      {
        width: 1024,
        height: 1024,
        url: `ipfs://${ipfsHash}`,
        verification: {
          method: "keccak256(bytes)",
          data: imageHash,
        },
      },
    ],
    images: [
      [
        {
          width: 1024,
          height: 1024,
          url: `ipfs://${ipfsHash}`,
          verification: {
            method: "keccak256(bytes)",
            data: imageHash,
          },
        },
      ],
    ],
    name: metadata.name,
    // attributes: metadata.attributes || [],
    attributes: [],
    // },
  };

  console.log("Uploading metadata to Pinata...");
  // Upload LSP4 metadata to Pinata
  const metadataFileName = `${metadata.name || "nft"}-meta-${Date.now()}`;
  const { ipfsHash: metadataHash, ipfsUri } = await uploadMetadataToIPFS(
    lsp4Metadata,
    metadataFileName
  );

  console.log("Metadata ipfs hash: ", metadataHash);

  console.log("Minting NFT...");
  // Mint the NFT
  const mintTx = await contract.mint(recipient, tokenIdBytes32, true, "0x");
  await mintTx.wait();

  // Set metadata
  // const encodedData = ethers.toUtf8Bytes(JSON.stringify(metadata));
  // const setDataTx = await contract.setData(
  //   ERC725YDataKeys.LSP4.LSP4Metadata,
  //   encodedData
  // );
  // await setDataTx.wait();

  // Set LSP4 metadata on-chain
  // const encoded = ethers.toUtf8Bytes(JSON.stringify(lsp4Metadata));

  const lsp4Encoded = ethers.toUtf8Bytes(JSON.stringify(lsp4Metadata));

  console.log("Setting NFT metadata...");

  // Use erc725.js to encode the metadata pointer as a VerifiableURI:

  const schema = [
    {
      name: "LSP4Metadata",
      key: "0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e",
      keyType: "Singleton",
      valueType: "bytes",
      valueContent: "VerifiableURI",
    },
  ];

  const myErc725 = new ERC725(schema);

  const { keys, values } = myErc725.encodeData([
    {
      keyName: "LSP4Metadata",
      value: {
        // json: require("./NFTMetadata.json"),
        json: lsp4Metadata,
        url: `ipfs://${metadataHash}`,
      },
    },
  ]);

  console.log("Keys: ", keys);
  console.log("Values: ", values);

  //=========

  const LSP4_METADATA_KEY = keccak256(toUtf8Bytes("LSP4Metadata"));

  // const setDataTx = await contract.setData(
  //   LSP4_METADATA_KEY,
  //   toUtf8Bytes(`ipfs://${metadataHash}`) // metadataIpfsUri should be in the format 'ipfs://<CID>'
  // );

  // const setDataTx = await contract.setData(
  //   ERC725YDataKeys.LSP4.LSP4Metadata,
  //   // encoded
  //   ethers.toUtf8Bytes(`ipfs://${metadataHash}`)
  //   // lsp4Encoded
  // );
  // await setDataTx.wait();

  // const tokenIdBytes32 = ethers.zeroPadValue("0x1", 32);

  console.log("tokenIdBytes32: ", tokenIdBytes32);

  await contract.setDataForTokenId(
    tokenIdBytes32,
    ERC725YDataKeys.LSP4["LSP4Metadata"],
    values[0] // The encoded value from erc725.js
  );

  console.log("Mint done.");

  return {
    success: true,
    message: `NFT minted to ${recipient} with token ID ${tokenId}. Metadata IPFS: ${ipfsUri}`,
  };

  // return `NFT minted to ${recipient} with token ID ${tokenId}`;
}

type MintRequestHandler = (
  req: Request,
  res: Response,
  next?: NextFunction
) => Promise<void>;

// Explicitly type your route handler
const mintHandler: MintRequestHandler = async (req, res) => {
  // const { recipientAddress, tokenId, metadata }: MintRequest = req.body;
  const { recipientAddress, metadata }: MintRequest = req.body;

  // if (!recipientAddress || !tokenId || !metadata) {
  if (!recipientAddress || !metadata) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  if (!ethers.isAddress(recipientAddress)) {
    res.status(400).json({ error: "Invalid recipient address" });
    return;
  }

  try {
    // const result = await mintNFT(recipientAddress, tokenId, metadata);
    const result = await mintNFT(recipientAddress, 1, metadata);
    res.json({
      success: true,
      message: result,
      contractAddress: nftCollectionAddress,
      // tokenId,
      tokenId: 1,
    });
  } catch (error) {
    console.error("Minting error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to mint NFT",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

// Register the route with the properly typed handler
// app.post("/api/mint", mintHandler);
// app.post("/api/mint", (req: Request, res: Response) => {
//   mintHandler(req, res).catch((err) => {
//     console.error("Unhandled error in mintHandler:", err);
//     res.status(500).json({ error: "Internal server error" });
//   });
// });
//==========
// app.post("/api/mint", (req, res, next) => {
//   mintHandler(req, res).catch(next);
// });
app.post("/api/mint", (req: Request, res: Response) => {
  (mintHandler(req, res) as Promise<void>).catch((err) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });
});

app.use("/api", imageRouter);

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// curl -X POST \
//   http://localhost:3000/api/mint \
//   -H "Content-Type: application/json" \
//   -d '{
//     "recipientAddress": "0xc86cEB5A3D0e51162C74aB04b9A8d116E1b23941",
//     "tokenId": 42,
//     "metadata": {
//       "name": "VIP Access Pass",
//       "description": "Exclusive community membership token",
//       "image": "ipfs://QmXJ5bb7dJQjZ4ZJ4ZJ4ZJ4ZJ4ZJ4ZJ4ZJ4ZJ4ZJ4ZJ4ZJ4Z",
//       "attributes": [
//         {
//           "trait_type": "Tier",
//           "value": "Gold"
//         }
//       ]
//     }
//   }'
