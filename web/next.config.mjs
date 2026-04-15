/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Keep dockerode + its native-crypto transitive deps out of Turbopack's
  // ESM bundling — they must be resolved at Node runtime from node_modules.
  // Phase 6 Plan 03: /api/logs/{containers,events} import docker-adapter.
  serverExternalPackages: ['dockerode', 'docker-modem', 'ssh2', 'cpu-features'],
};

export default nextConfig;
