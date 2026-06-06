# PixelOffice — Engineering Constitution & Build Plan

> A multiplayer virtual office inspired by Pokémon Emerald that helps distributed teams feel present, connected, and aware of each other's availability without becoming a surveillance tool.

---

# Vision

Employees should open:

```text
office.company.com
```

and immediately understand:

- Who is online
- Who is available
- Who is in a meeting
- Who is taking a break
- Where teammates are gathering

The office should feel alive, calm, and trustworthy.

---

# Product Philosophy

## What We Are Building

A presence-centric virtual workplace.

The office map is a visualization layer.

The true product is:

```text
Presence
+
Meetings
+
Social Interaction
+
Team Awareness
```

---

## What We Are NOT Building

- Slack replacement
- Microsoft Teams replacement
- Discord replacement
- Employee monitoring platform
- Productivity scoring system
- Project management software

---

# Core Design Principles

## Principle 1: Trust First

Users must feel:

```text
"I am working in a shared office."
```

Never:

```text
"My employer is tracking me."
```

---

## Principle 2: Presence, Not Surveillance

Allowed signals:

- Calendar events
- Meeting participation
- Explicit status selection
- Session activity

Forbidden signals:

- Keystroke logging
- Mouse tracking
- Screenshot capture
- IDE spying
- Productivity scores
- Activity ranking

---

## Principle 3: Business Logic Never Lives In The Game

Phaser is a rendering layer.

Phaser must not contain:

- Presence logic
- Calendar logic
- Authentication logic
- GreytHR logic

Those belong to backend services.

---

## Principle 4: Integrations Are Optional

If GreytHR fails:

```text
Office still works.
```

If Google Calendar fails:

```text
Office still works.
```

If Microsoft 365 fails:

```text
Office still works.
```

No integration should become a hard dependency.

---

## Principle 5: Human Agency

Users should retain control.

Examples:

### Good

```text
Meeting starts
↓
Status becomes "In Meeting"
↓
Join Meeting button appears
```

### Bad

```text
Meeting starts
↓
Avatar teleports automatically
```

---

# User Experience Goals

When a user enters the office:

1. Spawn at assigned desk
2. See nearby coworkers
3. See meeting rooms
4. See social spaces
5. Understand team availability

The office should require almost no training.

---

# Technical Architecture

## Layers

### Layer 1 — World Layer

Responsibilities:

- Rendering
- Avatars
- Movement
- Animations
- Interactions

Technology:

```text
Phaser
```

This layer knows nothing about:

- GreytHR
- Calendar
- OAuth
- Presence calculations

---

### Layer 2 — Presence Layer

Responsibilities:

- Availability state
- Meeting state
- Social state
- Presence calculations

Technology:

```text
NestJS
```

Outputs:

```typescript
AVAILABLE
IN_MEETING
FOCUS
BREAK
AWAY
OFFLINE
```

---

### Layer 3 — Integration Layer

Responsibilities:

- Google Workspace
- Microsoft 365
- GreytHR

Pattern:

```text
Adapter Pattern
```

Each integration must be independently removable.

---

### Layer 4 — Persistence Layer

Technology:

```text
PostgreSQL
Redis
```

Responsibilities:

- User storage
- Presence storage
- Event storage
- Session storage

---

# Recommended Tech Stack

## Frontend

- Next.js
- TypeScript
- Phaser 3
- TailwindCSS

## Backend

- NestJS
- PostgreSQL
- Redis

## Multiplayer

- Colyseus

## Authentication

- Google OAuth
- Microsoft OAuth

## Infrastructure

- Docker
- Docker Compose
- GitHub Actions

---

# Domain Model

## User

```typescript
interface User {
  id: string;
  email: string;
  displayName: string;
  avatarId: string;
  department: string;
}
```

---

## Presence

```typescript
interface Presence {
  userId: string;
  state: PresenceState;
  source: PresenceSource;
  updatedAt: Date;
}
```

---

## Meeting

```typescript
interface Meeting {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  participants: string[];
}
```

---

## Location

```typescript
interface Location {
  mapId: string;
  x: number;
  y: number;
}
```

---

## Event

```typescript
interface Event {
  id: string;
  type: string;
  startTime: Date;
  endTime: Date;
}
```

---

# Presence System

## Presence States

```typescript
enum PresenceState {
  AVAILABLE,
  IN_MEETING,
  FOCUS,
  BREAK,
  AWAY,
  OFFLINE
}
```

---

## State Rules

### IN_MEETING

Conditions:

- Active calendar meeting

Priority:

Highest

---

### BREAK

Conditions:

- User joined coffee break
- User joined social event

Priority:

Higher than AVAILABLE

---

### AWAY

Conditions:

- Session inactive for configurable duration

Priority:

Higher than AVAILABLE

---

### AVAILABLE

Default state.

---

# Office Layout

## Areas

### Reception

Purpose:

Landing zone for visitors.

---

### Engineering

Assigned desks for engineers.

---

### Product

Assigned desks for product team.

---

### Design

Assigned desks for designers.

---

### HR

Assigned desks for HR.

---

### Meeting Room A

Small meetings.

---

### Meeting Room B

Medium meetings.

---

### Meeting Room C

Large meetings.

---

### Coffee Area

Informal gatherings.

---

### Lounge

Social interactions.

---

# Avatar State Machine

## States

```typescript
IDLE
WALKING
TYPING
MEETING
COFFEE
```

---

## Rules

### AVAILABLE

Animation:

```text
IDLE
```

---

### FOCUS

Animation:

```text
TYPING
```

---

### BREAK

Animation:

```text
COFFEE
```

---

### IN_MEETING

Animation:

```text
MEETING
```

---

# Authentication

## V1

Allowed:

- Google OAuth
- Microsoft OAuth

---

## V2

Optional:

- GreytHR SSO
- SAML

---

## Forbidden

Do not build:

```text
Custom username/password auth
```

---

# GreytHR Integration Rules

## Allowed

- Employee lookup
- Department sync
- Attendance actions

---

## Forbidden

Do not:

- Auto-check-in
- Auto-check-out
- Auto-logout users

All attendance actions must be explicit.

---

# Calendar Integration

## V1

Google Calendar.

Required:

```typescript
getUpcomingMeetings()
getCurrentMeeting()
```

---

## V2

Microsoft 365.

---

# Coffee Break System

## Goals

Increase spontaneous interaction.

---

## Supported Events

- Coffee Break
- Tea Break
- Team Gathering
- Town Hall

---

## Flow

```text
Event Created
↓
Notification Sent
↓
User Joins
↓
Avatar Appears In Event Area
```

---

# Admin Console

## Features

### User Visibility

View:

- Active users
- Presence states
- Current locations

---

### Events

Create:

- Coffee break
- Team event
- Town hall

---

### Broadcasts

Send announcements.

---

# Non-Functional Requirements

## Performance

Support:

```text
100 concurrent users
```

Initial target.

---

## Reliability

Requirements:

- Recover from API failures
- Recover from service restarts
- Graceful degradation

---

## Security

Requirements:

- OAuth only
- JWT authentication
- Role-based access control
- HTTPS everywhere

---

# CLAUDE EXECUTION RULES

Add to CLAUDE.md

```md
# Engineering Rules

Never place business logic inside React components.

Never place business logic inside Phaser scenes.

Always use service layers.

Always define interfaces before implementations.

Always use dependency injection.

Always write tests for state transitions.

Never call third-party APIs directly from UI components.

Keep integrations isolated behind adapters.

Business logic must remain framework-independent.

Avoid premature optimization.

Prefer maintainability over cleverness.
```

---

# Task Execution Order

1. Repository Foundation
2. Domain Model Design
3. Authentication
4. Multiplayer Infrastructure
5. Office World
6. Presence Engine
7. Calendar Adapter
8. Avatar State Machine
9. Social Event Engine
10. Admin Console
11. GreytHR Adapter
12. Production Hardening

---

# Definition of Done

The project is complete when:

- Users can authenticate
- Users can enter the office
- Users can see coworkers
- Presence updates automatically
- Meeting information is visible
- Coffee breaks function correctly
- Office remains usable if integrations fail
- Core services have automated tests
- Architecture boundaries are respected
- No surveillance mechanisms exist

Success is measured by:

```text
Employees voluntarily keep the office open throughout the workday.
```
