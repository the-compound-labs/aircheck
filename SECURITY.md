# Security

Aircheck reads files on your disk and starts local agents. Its attack surface is limited but real. The media bridge on 127.0.0.1:3327 serves files only from folders in mediaRoots and only to Aircheck origins. A preview run has no network access and writes only inside its run folder.

## Report a vulnerability

Report a vulnerability privately through GitHub's private vulnerability reporting on this repository, or email hello@thecompound.tech. Do not open a public issue.

## Scope

The security scope includes the media bridge allow-list, the preview sandbox, the hosted account and its token handling, and the Worker's admission rules. The scheduler or posting job that a user wires into Aircheck is out of scope.
