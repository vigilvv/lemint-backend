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
// app.use(cors());
app.use(bodyParser.json());

// For production
app.use(
  cors({
    // origin: [
    //   "https://lemint.netlify.app",
    //   "http://localhost:3000", // Your dev server
    // ],
    origin: "https://lemint.netlify.app",
    methods: ["POST"], // Explicitly allow POST
  })
);

// Or for development when working locally
// app.use(cors({
//   origin: ['https://www.vigilv.com', 'http://localhost:3000']
// }));

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

  // Convert tokenId to proper LSP8 format (bytes32)
  const tokenIdBytes32 = ethers.zeroPadValue(ethers.toBeHex(tokenId), 32);

  console.log("Uploading image to Pinata...");
  // Upload image to IPFS
  const imageFileName = `${metadata.name}-${Date.now()}.png`;
  const { ipfsHash: imageIpfsHash } = await uploadToIPFS(
    metadata.mediaUrl.replace(/^data:image\/\w+;base64,/, ""),
    imageFileName
  );

  // Calculate image hash
  const imageBuffer = Buffer.from(
    metadata.mediaUrl.replace(/^data:image\/\w+;base64,/, ""),
    "base64"
  );
  const imageHash = keccak256(imageBuffer);

  // Construct PROPER LSP4 Metadata
  const lsp4Metadata = {
    LSP4Metadata: {
      description: metadata.description,
      links: [],
      icon: [
        {
          width: 1024,
          height: 1024,
          url: `ipfs://${imageIpfsHash}`,
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
            url: `ipfs://${imageIpfsHash}`,
            verification: {
              method: "keccak256(bytes)",
              data: imageHash,
            },
          },
        ],
      ],
      assets: [],
      attributes: metadata.attributes || [],
      name: metadata.name,
    },
  };

  console.log("Uploading metadata to Pinata...");
  // Upload metadata to IPFS
  const metadataFileName = `${metadata.name}-metadata-${Date.now()}.json`;
  const { ipfsHash: metadataIpfsHash } = await uploadMetadataToIPFS(
    lsp4Metadata,
    metadataFileName
  );

  // Mint the NFT first
  console.log("Minting NFT...");
  const mintTx = await contract.mint(
    recipient, // to
    tokenIdBytes32, // tokenId
    true, // force
    "0x", // data
    { gasLimit: 500000 } // Set appropriate gas limit
  );
  await mintTx.wait();

  // Prepare ERC725Y data key-value pairs
  const LSP4MetadataKey = ERC725YDataKeys.LSP4.LSP4Metadata;

  // Create VerifiableURI
  const metadataJSONString = JSON.stringify(lsp4Metadata);
  const metadataHash = keccak256(toUtf8Bytes(metadataJSONString));

  const verifiableURI = {
    json: lsp4Metadata,
    url: `ipfs://${metadataIpfsHash}`,
    hash: metadataHash,
  };

  // Encode using erc725.js
  const schema = [
    {
      name: "LSP4Metadata",
      key: LSP4MetadataKey,
      keyType: "Singleton",
      valueType: "bytes",
      valueContent: "VerifiableURI",
    },
  ];

  const erc725 = new ERC725(schema);
  const { values } = erc725.encodeData([
    {
      keyName: "LSP4Metadata",
      value: verifiableURI,
    },
  ]);

  // Set the metadata for the token
  console.log("Setting token metadata...");
  const setDataTx = await contract.setDataForTokenId(
    tokenIdBytes32,
    LSP4MetadataKey,
    values[0]
  );
  await setDataTx.wait();

  const setDataTx1 = await contract.setData(
    ERC725YDataKeys.LSP4.LSP4Metadata,
    // encoded
    ethers.toUtf8Bytes(`ipfs://${metadataHash}`)
    // lsp4Encoded
  );
  await setDataTx1.wait();

  console.log("Mint done");

  return {
    success: true,
    tokenId: tokenId,
    tokenIdBytes32: tokenIdBytes32,
    imageUrl: `ipfs://${imageIpfsHash}`,
    metadataUrl: `ipfs://${metadataIpfsHash}`,
    contractAddress: await contract.getAddress(),
  };
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

  console.log("recipientAddress: ", recipientAddress);
  // console.log("metadata: ", metadata);

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
