.PHONY: all build wasm wasm-web npm node test clean

CRATE := crates/prpr-auto-offset-wasm
NPM := npm
NODE_PKG := tests/pkg-node

all: build

# Build the wasm (bundler target) into npm/pkg, then compile the TS facade.
build: wasm npm

# wasm-pack bundler-target build → npm/pkg
wasm:
	cd $(CRATE) && wasm-pack build --target bundler --out-dir ../../$(NPM)/pkg

# Optionally *also* produce a native-ESM (web) build → npm/pkg-web
wasm-web:
	cd $(CRATE) && wasm-pack build --target web --out-dir ../../$(NPM)/pkg-web

# Compile the TypeScript facade → npm/dist
npm:
	cd $(NPM) && npm run build

# Node smoke test (builds a nodejs-target wasm into tests/pkg-node)
node:
	cd $(CRATE) && wasm-pack build --target nodejs --out-dir ../../$(NODE_PKG)
	node $(NODE_PKG)/../node-smoke.mjs

# Build nodejs-target wasm and run the smoke test
test: node

# Free build artifacts (leaves source + gitignored scratch)
clean:
	rm -rf target $(NPM)/pkg $(NPM)/pkg-web $(NPM)/dist $(NPM)/node_modules $(NODE_PKG)
