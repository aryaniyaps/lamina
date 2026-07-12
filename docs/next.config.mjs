import nextra from "nextra";

const withNextra = nextra({});

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/docs",
  assetPrefix: "/docs-static",
};

export default withNextra(nextConfig);
