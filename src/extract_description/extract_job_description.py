#!/usr/bin/env python3
"""
Extract job descriptions and qualifications from images using LLM.

This script processes job posting screenshots from files/job_images/ using
LiteLLM to extract structured information, saves it as markdown, and archives
the processed image.
"""

import os
import json
import base64
import shutil
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
import litellm

# Load environment variables
load_dotenv()

# Configuration from .env
MODEL_NAME = os.getenv("IMAGE_MODEL_NAME")
API_KEY = os.getenv("IMAGE_API_KEY")
API_BASE_URL = os.getenv("IMAGE_BASE_URL")

# Directory paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
JOB_IMAGES_DIR = BASE_DIR / "files" / "job_images"
COMPLETED_IMAGES_DIR = BASE_DIR / "files" / "completed_job_images"
JOB_DESCRIPTIONS_DIR = BASE_DIR / "files" / "job_descriptions"


def encode_image_to_base64(image_path: Path) -> str:
    """
    Encode image file to base64 string.

    Args:
        image_path: Path to the image file

    Returns:
        Base64 encoded string of the image
    """
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")


def get_image_mime_type(image_path: Path) -> str:
    """
    Get MIME type based on file extension.

    Only supports PNG and JPEG formats.

    Args:
        image_path: Path to the image file

    Returns:
        MIME type string (e.g., "image/jpeg" or "image/png")

    Raises:
        ValueError: If file extension is not .png, .jpg, or .jpeg
    """
    extension = image_path.suffix.lower()
    mime_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png"
    }

    if extension not in mime_types:
        raise ValueError(
            f"Unsupported image format: {extension}. "
            f"Only .png, .jpg, and .jpeg files are supported."
        )

    return mime_types[extension]


def extract_job_description(image_path: Path) -> dict:
    """
    Extract job description and qualifications from an image using LLM.

    Args:
        image_path: Path to the job description image

    Returns:
        Dictionary with keys: job_title, company, job_description,
        qualifications, additional_information

    Raises:
        ValueError: If image format is unsupported
        json.JSONDecodeError: If LLM response is not valid JSON
        litellm.exceptions.*: Various LLM API errors
    """
    # Encode image and get MIME type
    base64_image = encode_image_to_base64(image_path)
    mime_type = get_image_mime_type(image_path)

    # Set API key for litellm (supports multiple providers)
    if API_KEY:
        os.environ["OPENAI_API_KEY"] = API_KEY
        os.environ["ANTHROPIC_API_KEY"] = API_KEY
        os.environ["GEMINI_API_KEY"] = API_KEY

    # Set API base URL if provided (for custom endpoints)
    if API_BASE_URL:
        os.environ["OPENAI_API_BASE"] = API_BASE_URL

    # Prepare the extraction prompt for JSON output
    prompt = """Please extract the job description and qualifications from this image.

Return your response as a JSON object with the following structure:
{
  "job_title": "The job title",
  "company": "Company name (or 'Not specified' if not visible)",
  "job_description": "The full job description",
  "qualifications": "All qualifications, requirements, and skills listed",
  "additional_information": "Any other relevant information like salary, location, benefits, etc. (or 'None' if not available)"
}

Be thorough and capture all relevant details from the image. Return ONLY the JSON object, no additional text."""

    # Create message with image
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": prompt
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime_type};base64,{base64_image}"
                    }
                }
            ]
        }
    ]

    # Call LLM using litellm with JSON mode
    print(f"Calling LLM model: {MODEL_NAME}")
    response = litellm.completion(
        model=MODEL_NAME,
        messages=messages,
        max_tokens=2000,
        response_format={"type": "json_object"}  
    )

    # Extract and parse the JSON response
    response_text = response.choices[0].message.content

    # Some models wrap JSON in markdown code blocks, so clean it up
    if response_text.startswith("```"):
        # Remove markdown code block formatting
        response_text = response_text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        elif response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()

    job_data = json.loads(response_text)

    return job_data


def convert_json_to_markdown(job_data: dict) -> str:
    """
    Convert job data dictionary to formatted markdown.

    Args:
        job_data: Dictionary with job information

    Returns:
        Formatted markdown string
    """
    markdown = f"""# {job_data.get('job_title', 'Unknown Position')}

## Company
{job_data.get('company', 'Not specified')}

## Job Description
{job_data.get('job_description', 'No description provided')}

## Qualifications
{job_data.get('qualifications', 'No qualifications specified')}

## Additional Information
{job_data.get('additional_information', 'None')}
"""
    return markdown


def save_job_description(job_data: dict, original_filename: str) -> Path:
    """
    Save job description to markdown file.

    Args:
        job_data: Dictionary containing job information
        original_filename: Original image filename for reference

    Returns:
        Path to the saved markdown file
    """
    # Convert JSON to markdown
    markdown_content = convert_json_to_markdown(job_data)

    # Create filename with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = Path(original_filename).stem
    output_filename = f"{base_name}_{timestamp}.md"
    output_path = JOB_DESCRIPTIONS_DIR / output_filename

    # Save the markdown file
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(markdown_content)

    print(f"Job description saved to: {output_path}")
    return output_path


def move_processed_image(image_path: Path) -> None:
    """
    Move processed image to completed directory.

    Args:
        image_path: Path to the image file to move
    """
    destination = COMPLETED_IMAGES_DIR / image_path.name
    shutil.move(str(image_path), str(destination))
    print(f"Image moved to: {destination}")


def main():
    """Main execution function."""
    # Validate environment variables
    if not MODEL_NAME:
        raise ValueError(
            "IMAGE_MODEL_NAME not found in .env file. "
            "Please copy .env.example to .env and configure it."
        )
    if not API_KEY:
        raise ValueError(
            "IMAGE_API_KEY not found in .env file. "
            "Please copy .env.example to .env and configure it."
        )

    # Ensure directories exist
    JOB_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    COMPLETED_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    JOB_DESCRIPTIONS_DIR.mkdir(parents=True, exist_ok=True)

    # Find PNG or JPEG image in job_images directory
    image_extensions = [".jpg", ".jpeg", ".png"]
    image_files = [
        f for f in JOB_IMAGES_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in image_extensions
    ]

    if not image_files:
        raise FileNotFoundError(
            f"No PNG or JPEG images found in {JOB_IMAGES_DIR}. "
            f"Please add a job description screenshot."
        )

    if len(image_files) > 1:
        print(f"Warning: Multiple images found. Processing the first one: {image_files[0].name}")

    image_path = image_files[0]
    print(f"Processing image: {image_path.name}")

    try:
        # Extract job description using LLM (returns JSON dict)
        job_data = extract_job_description(image_path)

        # Save to markdown file (converts JSON to markdown)
        output_path = save_job_description(job_data, image_path.name)

        # Move image to completed directory
        move_processed_image(image_path)

        print("\nSuccess! Job description extraction completed.")
        print(f"  Markdown file: {output_path}")
        print(f"  Image archived: {COMPLETED_IMAGES_DIR / image_path.name}")

    except Exception as e:
        print(f"\nError during processing: {str(e)}")
        raise


if __name__ == "__main__":
    main()
