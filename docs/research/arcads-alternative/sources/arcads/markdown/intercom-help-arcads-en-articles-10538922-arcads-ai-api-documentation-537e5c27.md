# Arcads.ai API Documentation | Arcads Help Center

- URL: https://intercom.help/arcads/en/articles/10538922-arcads-ai-api-documentation
- Final URL: https://intercom.help/arcads/en/articles/10538922-arcads-ai-api-documentation
- Status: 200
- Content-Type: text/html; charset=utf-8
- Extracted: 2026-06-03T14:16:14.713895+00:00
- Description: Welcome to the Arcads.ai API documentation. This guide will help you integrate Arcads.ai's API into your workflow, enabling you to create products, manage scripts, and generate videos programmatically.

---

##

---

## 🏁 Getting Started

## 1️⃣ Create an Arcads Account

Sign up for an Arcads.ai account [here](https://arcads.ai) if you haven’t already. This is your first step to accessing the API.

2️⃣ Generate and Manage API Credentials

To generate your API credentials:

1. Log in to your Arcads account.
2. Navigate to **Settings > Public API**.
3. Click on **Generate credentials**.
4. Your Client ID and Client Secret will be displayed. Make sure to copy and securely store the Client Secret immediately, as it will only be shown once.

# Security Note on Client Secret Visibility

For security reasons, the Client Secret is only visible at the time of generation. If you do not save it during this time, it cannot be retrieved later. This measure ensures the confidentiality of your API credentials.

# Steps to Regenerate Credentials if Client Secret is Lost

If you lose your Client Secret, follow these steps to generate a new set of credentials:

1. Go to **Settings > Public API** in your Arcads account.
2. Select **Generate credentials** to create a new Client ID and Client Secret.
3. Update your application to use the new credentials.

🔹 **Authorization Header:**

```
const token = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
```

🔹 **Use this token in API requests:**

```
Authorization: <token>
```

This ensures your API requests are authenticated securely.
​

---

## ⚙️ Setting Up Your Environment

## 1️⃣ Create a Product

A product acts as a container for your scripts and videos.

🔹 **Create a new product:**

```
POST /v1/products
```

This returns a `productId`—save it for later.

🔹 **Retrieve existing products:**

```
GET /v1/products
```

This helps you manage and access all created products.

## 2️⃣ Create a Folder

Folders help organize scripts within a product.

🔹 **Create a folder inside a product:**

```
POST /v1/folders
```

This returns a `folderId`—save it for later.

🔹 **Retrieve existing folders within a product:**

```
GET /v1/products/:productId/folders
```

Use this to manage script storage efficiently.

## 3️⃣ List Available Situations

Situations define specific conditions or templates used in script creation.

🔹 **Retrieve all available situations (paginated API):**

```
GET /v1/situations
```

Save the `situationId` values you want to use for future reference.
​

---

## 🎬 Script Creation & Video Generation

## 1️⃣ Create a Script

A script contains the content and video references for generation.

🔹 **Create a script with `folderId`, `name`, `text`, and `videos`:**

```
POST /v1/scripts
```

This returns a `scriptId`—save it for later.

🔹 **Retrieve existing scripts within a folder:**

```
GET /v1/folders/:folderId/scripts
```

Allows you to access and manage stored scripts.

## 2️⃣ Edit a Script

Modify existing scripts as needed.

🔹 **Update a script:**

```
PUT /v1/scripts/:scriptId
```

Keep your scripts updated with necessary changes.

## 3️⃣ Generate Videos

Convert your scripts into videos with AI processing.

🔹 **Start video generation for a script:**

```
POST /v1/scripts/:scriptId/generate
```

Initiates the video creation process.

## 4️⃣ Check Video Status & Download

Monitor progress and retrieve generated videos.

🔹 **Retrieve the status of video generation and download link:**

```
GET /v1/scripts/:scriptId/videos
```

Check if your video is ready and get the download link.
​

---

## 📚 Additional Resources

For a complete reference of all available API endpoints with their complete parameters and responses, visit the [Arcads.ai](http://arcads.ai/) [External API Documentation](https://external-api.arcads.ai/docs).
