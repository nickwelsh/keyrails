# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

- Switched project tooling to Bun.
- Replaced Prettier with `oxfmt`.
- Added strict `oxlint` setup with type-aware linting.
- Updated GitHub Actions to use Bun, `oxfmt`, `oxlint`, type checks, tests, and build steps.

## [0.1.0] - 2026-03-19

### Added

- Forked `rails-main` into `keyrails`.
- Added configurable primary key support for generated CRUD helpers.
- Added support for custom key serialization and deserialization.
- Added relation helpers for associate and dissociate flows.
- Added pivot helpers for attach, detach, and sync flows.
- Added tests for custom keys and relation helpers.

### Changed

- Removed Reflect-related code and docs.
- Reworked docs around the current `keyrails` API and relation helpers.
