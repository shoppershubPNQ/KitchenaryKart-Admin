/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PDFKit ships font metric files (Helvetica.afm etc.) inside its
  // own `js/data/` folder and resolves them with fs.readFileSync at
  // runtime relative to its bundled location. Next.js's serverless
  // bundler tree-shakes these AFM files out, and bundling pdfkit at
  // all rewrites the data-path lookups so they break.
  //
  // Marking pdfkit as an external server package tells Next.js to
  // leave it in node_modules and require it at runtime — the data
  // files stay colocated with the JS that reads them. Vercel's
  // serverless trace already pulls in node_modules of any package
  // imported from a server function, so the AFM files come along.
  experimental: {
    // pdfkit reads font AFM files at runtime relative to its own
    // bundled location, so leaving it in node_modules keeps those
    // files where pdfkit looks for them. The TTF font we register
    // explicitly (Roboto, for ₹ + Unicode currency support) needs
    // its own files bundled via outputFileTracingIncludes below.
    serverComponentsExternalPackages: ['pdfkit'],
    outputFileTracingIncludes: {
      '/api/orders/[id]/invoice': [
        './node_modules/roboto-fontface/fonts/Roboto/Roboto-Regular.ttf',
        './node_modules/roboto-fontface/fonts/Roboto/Roboto-Bold.ttf',
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
