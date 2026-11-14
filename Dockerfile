# Runs the whole app (Vite front end + Netlify Functions) with `netlify dev`.
FROM node:22-bookworm-slim

# netlify dev needs Deno for its edge-functions layer. Copy a native binary
# (amd64 or arm64, matching the host) instead of letting the CLI download one.
COPY --from=denoland/deno:bin-2.6.0 /deno /usr/local/bin/deno

WORKDIR /app
ENV NETLIFY_TELEMETRY_DISABLED=1
ENV VITE_LISTEN_ALL=1
# Resolve "localhost" to 127.0.0.1 so netlify dev's internal servers agree on IPv4.
ENV NODE_OPTIONS=--dns-result-order=ipv4first

# Install dependencies first so Docker can cache this layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 8888
# --offline: no Netlify login or site link needed for local development.
CMD ["npx", "netlify", "dev", "--offline"]
