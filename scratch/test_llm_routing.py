from services.gemini_service import GeminiService

def test_routing():
    service = GeminiService()
    
    # Test languages that MUST use ChatGPT
    chatgpt_langs = ['kn', 'kannada', 'ml', 'malayalam', 'te', 'telugu', 'ta', 'tamil', 'mr', 'bn', 'gu']
    for lang in chatgpt_langs:
        assert service._is_chatgpt_language(lang) is True, f"Failed for {lang}, expected ChatGPT"
        
    # Test languages that MUST use Gemini
    gemini_langs = ['en', 'english', 'hi', 'hindi']
    for lang in gemini_langs:
        assert service._is_chatgpt_language(lang) is False, f"Failed for {lang}, expected Gemini"
        
    print("[SUCCESS] All LLM Routing assertions passed successfully!")

if __name__ == '__main__':
    test_routing()
