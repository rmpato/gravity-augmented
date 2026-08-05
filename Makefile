.DEFAULT_GOAL := help
SHELL := /bin/bash

## status: power level, saga progress, what's next
status:
	@./bin/scouter status

## next: open what you should do now
next:
	@./bin/scouter next

## list: every capsule and its state
list:
	@./bin/scouter list

## read: open the capsules in a browser (http://localhost:8420)
read:
	@./bin/serve

## doctor: check your machine has the required tooling
doctor:
	@./bin/doctor

## help: this
help:
	@echo ""
	@echo "  Gravity Augmented"
	@echo ""
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  make /' | awk -F': ' '{printf "  %-18s %s\n", $$1, $$2}' | sed 's/^  make/make/;s/^/  /'
	@echo ""
	@echo "  Capsule labs are run from YOUR gravity-chamber repo, not this one."
	@echo ""

.PHONY: status next list read doctor help
