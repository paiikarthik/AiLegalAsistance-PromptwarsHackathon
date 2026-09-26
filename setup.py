from setuptools import setup, find_packages

setup(
    name="lawbuddy-ai",
    version="1.0.0",
    description="AI-Powered Plain-Language Legal Document Simplification & Case Assistance Platform",
    author="Karthik Pai",
    packages=find_packages(),
    install_requires=[
        "flask",
        "pytest",
        "pytest-cov"
    ],
    python_requires=">=3.9",
)
