import express from "express";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import axios from "axios";
import cors from "cors";
import mongoose from "mongoose";
import Image from "./models/Image.js";

dotenv.config();

// MongoDB (Mongoose) connect
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/iot";
mongoose
    .connect(MONGODB_URI, {
        // Mongoose 7+ has sensible defaults; keep options for older compatibility
    })
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB connection error:", err));

const app = express();
app.use(cors());
app.disable("x-powered-by");

// JSON parsing for API responses where needed
app.use(express.json());

// Cloudinary config
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET,
    secure: true,
});

// Simple health check
app.get("/", (req, res) => res.send("ESP32 Upload Server: OK"));

// Return recent saved images (no auth)
// Query params: ?limit=20&deviceId=esp32-1
app.get("/images", async (req, res) => {
    try {
        const limit = Math.min(100, parseInt(req.query.limit || "20", 10));
        const filter = {};
        if (req.query.deviceId) filter.deviceId = req.query.deviceId;
        const docs = await Image.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .select({
                url: 1,
                deviceId: 1,
                createdAt: 1,
                public_id: 1,
                width: 1,
                height: 1,
                bytes: 1,
            })
            .lean();
        return res.json({ ok: true, images: docs });
    } catch (err) {
        console.error("GET /images error", err);
        return res.status(500).json({ ok: false, error: String(err) });
    }
});

// Accept raw image/jpeg body
app.post(
    "/upload",
    express.raw({ type: "image/*", limit: "3mb" }),
    async (req, res) => {
        try {
            console.log("Received");
            const apiKey = req.headers["x-api-key"] || req.query.apiKey;
            const deviceId =
                req.headers["x-device-id"] ||
                req.query.deviceId ||
                "unknown_device";

            if (!apiKey || apiKey !== process.env.DEVICE_API_KEY) {
                return res
                    .status(401)
                    .json({ error: "Unauthorized: invalid api key" });
            }

            const buffer = req.body;
            if (!buffer || buffer.length === 0) {
                return res.status(400).json({ error: "No image uploaded" });
            }

            // Upload buffer to Cloudinary via upload_stream
            const folder = `esp32/${deviceId}`;
            const uploadResult = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { folder, resource_type: "image" },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );
                streamifier.createReadStream(buffer).pipe(uploadStream);
            });

            // Save Cloudinary URL + metadata to MongoDB (do NOT store binary buffer)
            let savedDoc = null;
            try {
                const imgDoc = new Image({
                    deviceId,
                    url: uploadResult.secure_url,
                    public_id: uploadResult.public_id,
                    width: uploadResult.width,
                    height: uploadResult.height,
                    bytes: uploadResult.bytes,
                });
                savedDoc = await imgDoc.save();
                console.log(
                    "Saved image metadata to MongoDB, id=",
                    savedDoc._id.toString()
                );
            } catch (saveErr) {
                console.warn(
                    "Failed to save image metadata to MongoDB:",
                    saveErr?.message || saveErr
                );
            }

            // Optionally send Telegram notification with Cloudinary URL
            const tgToken = process.env.TELEGRAM_BOT_TOKEN;
            const tgChat = process.env.TELEGRAM_CHAT_ID;
            if (tgToken && tgChat) {
                try {
                    const caption = `Visitor at ${deviceId} — ${new Date().toLocaleString(
                        "en-IN",
                        { timeZone: "Asia/Kolkata" }
                    )}`;
                    // Use sendPhoto with url
                    const tgUrl = `https://api.telegram.org/bot${tgToken}/sendPhoto`;
                    await axios.post(`${tgUrl}`, null, {
                        params: {
                            chat_id: tgChat,
                            photo: uploadResult.secure_url,
                            caption,
                        },
                        timeout: 10000,
                    });
                } catch (tgErr) {
                    console.warn(
                        "Telegram notify failed:",
                        tgErr.message || tgErr
                    );
                }
            }

            // Respond with uploaded URL, metadata and MongoDB id/timestamp when available
            const resp = {
                ok: true,
                url: uploadResult.secure_url,
                public_id: uploadResult.public_id,
                width: uploadResult.width,
                height: uploadResult.height,
                bytes: uploadResult.bytes,
            };
            if (savedDoc) {
                resp.imageId = savedDoc._id;
                resp.savedAt =
                    savedDoc.createdAt || savedDoc._id.getTimestamp?.();
            }
            return res.json(resp);
        } catch (err) {
            console.error("Upload error:", err);
            return res.status(500).json({ error: String(err) });
        }
    }
);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
