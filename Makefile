# Makefile for orchestrator full-stack testing

.PHONY: test up down logs

default: test

up:
	docker-compose up -d postgres rabbitmq neo4j

down:
	docker-compose down

logs:
	docker-compose logs --tail=100

test: up
	pytest --maxfail=3 --disable-warnings -v tests

test-all: up
	pytest --disable-warnings -v tests

test-integration: up
	pytest --maxfail=3 --disable-warnings -v tests/integration
