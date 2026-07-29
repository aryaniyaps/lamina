#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

const workspace = process.cwd();
const mockPort = Number(process.env.LAMINA_EVAL_SHOPIFY_PORT || 43110);
const appPort = Number(process.env.LAMINA_EVAL_APP_PORT || 43111);
const runtimeDir = path.join(workspace, '.git', 'lamina', 'audit-runtime');
const keyPath = path.join(runtimeDir, 'mock-shopify-key.pem');
const certPath = path.join(runtimeDir, 'mock-shopify-cert.pem');

if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ app_url: `http://127.0.0.1:${appPort}`, mock_port: mockPort }));
  process.exit(0);
}

fs.mkdirSync(runtimeDir, { recursive: true });
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  const generated = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath,
    '-out', certPath,
    '-subj', '/CN=localhost',
    '-days', '1',
  ], { stdio: 'ignore' });
  if (generated.status !== 0) {
    throw new Error('Unable to generate the local audit certificate with openssl');
  }
}

const imageUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const product = {
  id: 'gid://shopify/Product/recovery-test',
  handle: 'recovery-test-product',
  availableForSale: true,
  title: 'Recovery Test Product',
  description: 'A deterministic product for live checkout audits.',
  descriptionHtml: '<p>A deterministic product for live checkout audits.</p>',
  options: [],
  priceRange: {
    maxVariantPrice: { amount: '19.00', currencyCode: 'USD' },
    minVariantPrice: { amount: '19.00', currencyCode: 'USD' },
  },
  featuredImage: { url: imageUrl, altText: 'Recovery Test Product', width: 96, height: 96 },
  images: {
    edges: [{
      node: { url: imageUrl, altText: 'Recovery Test Product', width: 96, height: 96 },
    }],
  },
  seo: { title: 'Recovery Test Product', description: 'Live checkout audit fixture' },
  tags: [],
  updatedAt: '2026-07-30T00:00:00.000Z',
  variants: {
    edges: [{
      node: {
        id: 'gid://shopify/ProductVariant/recovery-test',
        title: 'Default Title',
        availableForSale: true,
        selectedOptions: [],
        price: { amount: '19.00', currencyCode: 'USD' },
      },
    }],
  },
};
const cart = {
  id: 'gid://shopify/Cart/recovery-test',
  checkoutUrl: 'https://checkout.example.test/recovery',
  totalQuantity: 1,
  cost: {
    subtotalAmount: { amount: '19.00', currencyCode: 'USD' },
    totalAmount: { amount: '19.00', currencyCode: 'USD' },
    totalTaxAmount: { amount: '0', currencyCode: 'USD' },
  },
  lines: {
    edges: [{
      node: {
        id: 'gid://shopify/CartLine/recovery-test',
        quantity: 1,
        cost: { totalAmount: { amount: '19.00', currencyCode: 'USD' } },
        merchandise: {
          id: 'gid://shopify/ProductVariant/recovery-test',
          title: 'Default Title',
          selectedOptions: [],
          product,
        },
      },
    }],
  },
};

let getCartCount = 0;
const mock = https.createServer({
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
}, (request, response) => {
  let raw = '';
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => {
    const query = raw ? JSON.parse(raw).query || '' : '';
    let body;
    if (/\bquery\s+getCart\b/.test(query)) {
      getCartCount += 1;
      body = getCartCount % 2 === 0
        ? { errors: [{ message: 'Simulated checkout connection failure' }] }
        : { data: { cart } };
    } else if (/\bcartCreate\s*\(/.test(query)) {
      body = { data: { cartCreate: { cart } } };
    } else if (/\bcartLinesAdd\s*\(/.test(query)) {
      body = { data: { cartLinesAdd: { cart } } };
    } else if (/\bproductRecommendations\s*\(/.test(query)) {
      body = { data: { productRecommendations: [] } };
    } else if (/\bproduct\s*\(/.test(query)) {
      body = { data: { product } };
    } else if (/\bcollection\s*\(/.test(query)) {
      body = { data: { collection: { products: { edges: [{ node: product }] } } } };
    } else if (/\bcollections\s*\(/.test(query)) {
      body = { data: { collections: { edges: [] } } };
    } else if (/\bmenu\s*\(/.test(query)) {
      body = { data: { menu: { items: [] } } };
    } else {
      body = { data: {} };
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
});

let app;
function stop(signal = 'SIGTERM') {
  if (app && !app.killed) app.kill(signal);
  mock.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

mock.listen(mockPort, '127.0.0.1', () => {
  const next = path.join(workspace, 'node_modules', '.bin', 'next');
  app = spawn(next, ['dev', '--turbopack', '-p', String(appPort)], {
    cwd: workspace,
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: certPath,
      SHOPIFY_STORE_DOMAIN: `localhost:${mockPort}`,
      SHOPIFY_STOREFRONT_ACCESS_TOKEN: 'lamina-eval',
    },
    stdio: 'inherit',
  });
  app.on('exit', (code, signal) => {
    if (code && !signal) process.exitCode = code;
    mock.close(() => process.exit(process.exitCode || 0));
  });
  console.log(`Lamina live audit fixture: http://127.0.0.1:${appPort}/product/recovery-test-product`);
});
