---
status: accepted
---

# Close each candidate's exported surface

The Candidate Declaration Gate evaluates every export, not only declarations named as new obligations. A create candidate may export only approved declarations; a replacement candidate must preserve every frozen baseline export unless an approved Documented Declaration explicitly adds, changes, or removes it, while private helpers remain outside the gate. This prevents an Agent from satisfying one required declaration while silently changing another public interface.
