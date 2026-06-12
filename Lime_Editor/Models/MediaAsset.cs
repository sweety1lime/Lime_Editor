using System;

#nullable disable

namespace Lime_Editor.Models
{
    public class MediaAsset
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        public string OriginalName { get; set; }
        public string StoredFileName { get; set; }
        public string ContentType { get; set; }
        public long SizeBytes { get; set; }
        public DateTime UploadedAt { get; set; }
    }
}
