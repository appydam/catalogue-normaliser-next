import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "CatalogAI – Your Supplier Intelligence Platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
          padding: "80px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Logo + Name */}
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          {/* Logo square */}
          <div
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "18px",
              background: "rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "40px",
            }}
          >
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <rect x="4" y="2" width="28" height="36" rx="4" fill="rgba(255,255,255,0.9)" />
              <rect x="10" y="10" width="14" height="2.5" rx="1" fill="rgba(99,102,241,0.4)" />
              <rect x="10" y="16" width="18" height="2.5" rx="1" fill="rgba(99,102,241,0.3)" />
              <rect x="10" y="22" width="16" height="2.5" rx="1" fill="rgba(99,102,241,0.3)" />
              <circle cx="30" cy="30" r="10" fill="#6366f1" />
              <path d="M30 22 L31 27.5 L36.5 28.5 L31 29.5 L30 35 L29 29.5 L23.5 28.5 L29 27.5 Z" fill="white" />
            </svg>
          </div>
          <div
            style={{
              fontSize: "56px",
              fontWeight: 800,
              color: "white",
              letterSpacing: "-1px",
            }}
          >
            CatalogAI
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: "30px",
            fontWeight: 500,
            color: "rgba(255,255,255,0.85)",
            marginTop: "24px",
          }}
        >
          Your Supplier Intelligence Platform
        </div>

        {/* Feature pills */}
        <div style={{ display: "flex", gap: "16px", marginTop: "40px" }}>
          {["Catalog Extraction", "Price Comparison", "Scheme Tracking", "Smart Procurement"].map(
            (feature) => (
              <div
                key={feature}
                style={{
                  padding: "10px 24px",
                  borderRadius: "20px",
                  background: "rgba(255,255,255,0.15)",
                  color: "rgba(255,255,255,0.9)",
                  fontSize: "16px",
                  fontWeight: 600,
                }}
              >
                {feature}
              </div>
            )
          )}
        </div>

        {/* Bottom tagline */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            left: "80px",
            fontSize: "16px",
            color: "rgba(255,255,255,0.5)",
            fontWeight: 500,
          }}
        >
          Turn supplier catalogs into business intelligence
        </div>
      </div>
    ),
    { ...size }
  );
}
