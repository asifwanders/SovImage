# SovImage Privacy Policy

Effective: 2 September 2026

SovImage is an offline-first desktop application. It has no SovImage account,
analytics SDK, advertising SDK, telemetry service, crash-upload service, or
cloud image-generation backend.

## Data stored on your device

SovImage stores chats, prompts, settings, model files, attached source images,
generated images, and short-lived prompt files in its application-data
container. This data is used only to provide features on your device. It is not
sent to the SovImage maintainers.

When you choose an input or export destination, the operating system grants
SovImage access to that user-selected file or directory. Copying an image uses
the operating-system clipboard. SovImage does not scan unrelated files.

## Network activity

On initial setup or when a model pack changes, SovImage downloads model files
from Hugging Face and its content-delivery providers. Those providers receive
ordinary connection data such as your IP address, request time, requested file,
and HTTP metadata under their own privacy terms. Model downloads contain no
prompt, source image, generated image, or chat history.

Opening a repository, issue, privacy, or license link launches your default
browser and is then governed by the destination site's policy.

## Collection and sharing

The maintainer does not receive, sell, rent, use for tracking, or share prompts,
images, or chat records through SovImage. The Mac App Store disclosure is
pending provider-policy review: Hugging Face and its CDN receive the connection
metadata described above, so “Data Not Collected” must not be selected until
their retention and use are reviewed against Apple's definitions. The checked-in
privacy manifest records the app's current lack of tracking SDKs; it is not a
substitute for that store-label decision. The policy, manifest, and store answer
must agree before submission.

## Deletion and retention

Local records remain until you delete them in the app or remove its application
data. Exported files remain wherever you saved them. Operating-system backups
may retain copies according to your backup settings.

## Security and contact

See [SECURITY.md](SECURITY.md) for the security boundary and private reporting
channel. Privacy questions can be opened as a public repository discussion or
issue only when they contain no sensitive information; sensitive reports must
use a private GitHub Security Advisory.

Policy URL for store metadata:
<https://github.com/asifwanders/SovImage/blob/main/PRIVACY.md>
