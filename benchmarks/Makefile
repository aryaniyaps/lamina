.PHONY: bench:validate bench:run bench:score bench:analyze bench:human-packet bench:all bench:pipeline-check

bench:validate:
	cd .. && npm run bench:validate

bench:run:
	cd .. && npm run bench:run

bench:score:
	cd .. && npm run bench:score

bench:analyze:
	cd .. && npm run bench:analyze

bench:human-packet:
	cd .. && npm run bench:human-packet

# Live release path — never passes --mock
bench:all: bench:validate bench:run bench:score bench:analyze bench:human-packet

# Mock pipeline check only — not for external claims
bench:pipeline-check:
	cd .. && npm run bench:pipeline-check
