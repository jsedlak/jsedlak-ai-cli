# @jsedlak/ai

A CLI tool that installs AI Coding Agent files and commands for Task-based development workflows.

## Overview

This package scaffolds template files that enable a structured, task-driven approach to AI-assisted software development. It installs prompt templates and commands that help AI coding agents (like Claude, Cursor, etc.) follow a consistent workflow:

1. **Create a PRD** - Generate a Product Requirements Document from a feature request
2. **Generate Tasks** - Break down the PRD into actionable, step-by-step tasks
3. **Process Tasks** - Execute tasks one at a time with proper tracking and version control

## Installation

```bash
npx @jsedlak/ai init
```

This command copies the template files into your current project directory.

## What Gets Installed

### `.ai/` Directory

Prompt templates for AI agents:

- **`create-prd.md`** - Instructions for generating a Product Requirements Document with clarifying questions
- **`generate-tasks.md`** - Instructions for breaking down requirements into parent tasks and sub-tasks
- **`process-tasks.md`** - Guidelines for executing tasks with proper completion tracking and git commits

### `.claude/commands/` Directory

Claude-specific slash commands that reference the `.ai/` templates:

- **`create-prd.md`** - `/create-prd` command
- **`create-tasks.md`** - `/create-tasks` command
- **`process-tasks.md`** - `/process-tasks` command

## Workflow

### 1. Create a PRD

Start by describing your feature. The AI will ask clarifying questions and generate a structured PRD saved to `.prd/[feature-name]/prd.md`.

### 2. Generate Tasks

Point the AI at your PRD to generate a task list. The AI first creates high-level parent tasks, waits for confirmation, then generates detailed sub-tasks. Output is saved to `.prd/[feature-name]/tasks.md`.

### 3. Process Tasks

Work through tasks one sub-task at a time. The AI:
- Marks completed sub-tasks with `[x]`
- Runs tests after completing all sub-tasks of a parent task
- Creates git commits with descriptive messages
- Waits for your approval before proceeding to the next task

## CLI Commands

```bash
npx @jsedlak/ai init     # Initialize project with template files
npx @jsedlak/ai -v       # Show version
npx @jsedlak/ai -h       # Show help
```

## Requirements

- Node.js 18 or higher

## Acknowledgments

This project is based on the task-driven development workflow patterns from [ai-dev-tasks](https://github.com/snarktank/ai-dev-tasks) by snarktank.

## License

Apache-2.0
