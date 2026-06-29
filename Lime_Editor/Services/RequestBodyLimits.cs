namespace Lime_Editor.Services
{
    public static class RequestBodyLimits
    {
        public const long CspReportBytes = 16 * 1024;
        public const long SmallFormBytes = 32 * 1024;
        public const long PublicFormBytes = 64 * 1024;
        public const long WebhookBytes = 64 * 1024;
        public const long DataFormBytes = 256 * 1024;
        public const long AiSmallBytes = 32 * 1024;
        public const long AiMediumBytes = 64 * 1024;
        public const long AiLargeBytes = 256 * 1024;
        public const long EditorDocumentBytes = 4 * 1024 * 1024;
    }
}
