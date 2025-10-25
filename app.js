import express from "express";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import axios from "axios";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.disable("x-powered-by");

// Cloudinary config
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET,
    secure: true,
});

// Simple health check
app.get("/", (req, res) => res.send("ESP32 Upload Server: OK"));

// Accept raw image/jpeg body
app.post(
    "/upload",
    express.raw({ type: "image/*", limit: "3mb" }),
    async (req, res) => {
        try {
            console.log("Received")
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

            // Optionally send Telegram notification with Cloudinary URL
            const tgToken = process.env.TELEGRAM_BOT_TOKEN;
            const tgChat = process.env.TELEGRAM_CHAT_ID;
            if (tgToken && tgChat) {
                try {
                    const caption = `Visitor at ${deviceId} — ${new Date().toLocaleString()}`;
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

            // Respond with uploaded URL and metadata
            return res.json({
                ok: true,
                url: uploadResult.secure_url,
                public_id: uploadResult.public_id,
                width: uploadResult.width,
                height: uploadResult.height,
                bytes: uploadResult.bytes,
            });
        } catch (err) {
            console.error("Upload error:", err);
            return res.status(500).json({ error: String(err) });
        }
    }
);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
