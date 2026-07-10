.PHONY: bench:validate bench:run bench:score bench:analyze bench:all bench:pipeline-check bench:probes bench:analyst

bench:validate:
	cd .. && npm run bench:validate

bench:run:
	cd .. && npm run bench:run

bench:score:
	cd .. && npm run bench:score

bench:analyze:
	cd .. && npm run bench:analyze

bench:probes:
	cd .. && npm run bench:probes

bench:analyst:
	cd .. && npm run bench:analyst

# Live release path — never passes --mock
bench:all: bench:validate bench:run bench:score bench:analyze

# Mock pipeline check only — not for external claims
bench:pipeline-check:
	cd .. && npm run bench:pipeline-check
