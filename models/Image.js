import mongoose from "mongoose";

// Store only Cloudinary metadata (URL, public_id, size) and deviceId + timestamp
const ImageSchema = new mongoose.Schema(
    {
        deviceId: { type: String, default: "unknown_device", index: true },
        url: { type: String, required: true },
        public_id: String,
        width: Number,
        height: Number,
        bytes: Number,
    },
    { timestamps: { createdAt: "createdAt" } }
);

export default mongoose.models.Image || mongoose.model("Image", ImageSchema);
