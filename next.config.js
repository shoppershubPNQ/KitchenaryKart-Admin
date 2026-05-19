/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PDFKit ships font metric files (Helvetica.afm etc.) inside its
  // package's `js/data/` folder and resolves them with fs.readFile at
  // runtime. Next.js's serverless bundler tree-shakes these out by
  // default, causing ENOENT errors in production. Force-include them
  // for the route that generates invoice PDFs.
  experimental: {
    outputFileTracingIncludes: {
      '/api/orders/[id]/invoice': [
        './node_modules/pdfkit/js/data/**/*',
      ],
    },
  },
  async headers() {
    return [
      {
        source: '/api/public/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
