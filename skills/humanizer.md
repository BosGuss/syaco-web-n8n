---
name: humanizer
description: Rewrite AI-generated text to sound natural, conversational, and human-written while preserving the original meaning, technical accuracy, and intent. Useful for community replies, technical discussions, and backlink outreach.
---

# Humanizer Skill

## Objective

Rewrite AI-generated text to sound natural, clear, and conversational, as if written by a knowledgeable person participating in a real discussion.

The goal is not to disguise AI-generated content or fool AI detectors. The goal is to improve readability, remove robotic phrasing, and make responses genuinely useful to the reader.

## Core Principles

### 1. Preserve the Original Meaning

* Keep the original message, facts, technical details, and recommendations intact.
* Do not introduce unsupported claims, invented experiences, or fabricated statistics.
* Do not change the author's intended meaning.
* If the original text is technically accurate, preserve its technical accuracy.

### 2. Use Natural Language

* Prefer everyday language over unnecessarily formal or academic wording.
* Use contractions where appropriate in English, such as "it's", "you'll", "that's", and "don't".
* Vary sentence length and structure naturally.
* Use simple words when they communicate the idea more clearly.
* Allow a slightly informal tone when the context is a community discussion.

### 3. Remove Robotic Phrasing

Avoid overused AI expressions such as:

* "In today's rapidly evolving digital landscape"
* "It's important to note that"
* "Furthermore, moreover, and additionally" when unnecessary
* "By leveraging the power of"
* "This highlights the importance of"
* "In conclusion"
* "There are several key factors to consider"
* "A comprehensive and robust solution"

Replace these phrases with direct, specific language.

### 4. Avoid Overly Structured Responses

* Do not automatically turn every answer into a numbered list.
* Avoid unnecessary introductions and summaries.
* Do not add headings unless they improve readability.
* Avoid repeating the same point in different words.
* Do not force a conclusion when the answer is already complete.

### 5. Match the Platform and Context

**Reddit**

* Sound like someone contributing to an ongoing conversation.
* Address the actual question before offering additional information.
* Be helpful without sounding like a salesperson.
* Avoid promotional language and generic opening statements.
* Use technical explanations when relevant, but keep them accessible.

**Dev.to**

* Use a developer-friendly tone.
* Include specific technical details where useful.
* Keep explanations practical and easy to follow.
* Avoid exaggerated claims and unnecessary marketing language.

**Bluesky and short-form discussions**

* Keep the response concise and conversational.
* Focus on one main idea.
* Avoid lengthy explanations unless the discussion calls for them.

**Technical forums**

* Prioritize accuracy and actionable advice.
* Explain technical concepts clearly without oversimplifying them.
* Use examples only when they help solve the actual problem.

## Backlink and Brand Mention Rules

* Answer the original question first.
* Make the response useful even if all links are removed.
* Mention SyaCo only when its services or relevant solution genuinely fit the discussion.
* Never force a SyaCo link into an unrelated conversation.
* Do not turn an informative answer into an advertisement.
* Integrate a relevant link naturally into the sentence when appropriate.
* Use descriptive anchor text that explains what the reader will find.
* Do not repeat the company name or link unnecessarily.
* If the original draft contains an irrelevant link, recommend removing it rather than rewriting the surrounding text to justify it.
* Never invent a customer's experience, personal testimonial, or first-hand experience with SyaCo.

## Technical Writing Rules

* Keep product names, programming languages, API terminology, code, and technical concepts accurate.
* Do not remove essential implementation details to make the text sound more casual.
* Preserve code snippets, URLs, configuration values, and identifiers unless explicitly asked to change them.
* Prefer concrete explanations over vague statements.
* Avoid presenting assumptions as confirmed facts.

## Output Requirements

When given a draft to humanize:

1. Identify the main point and intended audience.
2. Remove unnecessary repetition and generic AI-style wording.
3. Rewrite sentences using natural phrasing.
4. Match the platform's tone and expected response length.
5. Preserve technical accuracy and the original intent.
6. Check whether any company mention or backlink is genuinely relevant.
7. Return only the revised text unless the user explicitly requests an explanation.

Do not describe the rewriting process.
Do not add a preamble such as "Here is the improved version."
Do not provide multiple alternatives unless requested.

## Final Quality Check

Before returning the result, verify:

* Does it answer the original question directly?
* Does it sound natural when read aloud?
* Are any sentences unnecessarily formal or repetitive?
* Does it sound like an advertisement?
* Are the facts and technical details preserved?
* Is every link relevant to the discussion?
* Could the answer be shorter without losing useful information?

If the draft already sounds natural, make only minor edits instead of rewriting it unnecessarily.
