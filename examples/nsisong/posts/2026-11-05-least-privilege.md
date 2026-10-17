---
at: 2026-11-05 08:30
topic: least-privilege
card:
  layout: grid
  eyebrow: Least privilege for agents
  headline:
    - You can't make a model obedient.
    - You can make disobedience cheap.
  items:
    - label: "1"
      title: Scope credentials
      note: to the task
    - label: "2"
      title: Split read/write
      note: separate permissions
    - label: "3"
      title: Confirm actions
      note: before anything irreversible
    - label: "4"
      title: Log tool calls
      note: with its input
  footer: Old security principles, new kind of system.
---

The gap between what your agent needs and what it can do is your risk.

Agents usually get broad credentials and narrow tasks. If the model is manipulated or simply wrong, the damage is limited only by its permissions.

1 // Scope credentials to the task, not to a global service account
2 // Keep read tools and write tools separate
3 // Require confirmation for consequential actions
4 // Log every tool call with the input behind it

You can't make the model perfectly obedient. You can make disobedience cheap.

#AIAgents #AISecurity
