# Privacy Policy for SpotLight

Last updated: September 2026

BeaconLight ("we", "our", or "the extension") is a privacy-first, local-only Chrome extension built for web inspection, tracker blocking, and fingerprint protection. 

## 1. Data Collection and Processing
BeaconLight operates under a strict **Zero-Data Collection / Local-First** architecture:
- **No Personal Data Sent:** We do not collect, store, transmit, or sell any personal data, IP addresses, browsing history, or user credentials.
- **Local Network Inspection:** Outgoing web requests (URLs, methods, and payload snippets) are inspected ephemerally in your browser's local memory to detect tracking patterns.
- **No External Servers:** 100% of data processing, classification, blocking, and spoofing occurs directly on your local device. No telemetry or analytics leave your browser.

## 2. Permissions Usage
- `webRequest`: Used solely for non-blocking local observation of outgoing web traffic to identify trackers.
- `declarativeNetRequest`: Used to block known tracker domains locally at the network layer.
- `storage`: Used to save your domain blocklists and settings locally on your computer.
- `tabs` & `activeTab`: Used to display requests associated with the active tab and differentiate between first-party and third-party network calls.
- `sidePanel`: Used to render the inspector dashboard inside Chrome's side panel.

## 3. Third-Party Sharing
BeaconLight does not communicate with any third-party APIs, remote AI models, or analytics services. We do not sell user data to data brokers or advertising platforms.

## 4. Contact
For questions regarding this policy or the extension codebase, open an issue on our GitHub repository.
