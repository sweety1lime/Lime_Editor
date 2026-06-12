using Lime_Editor.Services;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.PixelFormats;
using System.IO;
using System.Threading.Tasks;
using Xunit;

namespace Lime.Tests.Services
{
    public class ImageSharpProcessorTests
    {
        private readonly ImageSharpProcessor _processor = new();

        private static byte[] MakeJpeg(int width, int height)
        {
            using var img = new Image<Rgba32>(width, height);
            // Заливаем градиентом, чтобы получить реалистичный JPEG (а не мегакомпрессируемый одноцветник).
            img.ProcessPixelRows(accessor =>
            {
                for (int y = 0; y < accessor.Height; y++)
                {
                    var row = accessor.GetRowSpan(y);
                    for (int x = 0; x < row.Length; x++)
                    {
                        row[x] = new Rgba32((byte)(x % 256), (byte)(y % 256), (byte)((x + y) % 256));
                    }
                }
            });
            using var ms = new MemoryStream();
            img.SaveAsJpeg(ms, new JpegEncoder { Quality = 95 });
            return ms.ToArray();
        }

        private static byte[] MakePng(int width, int height)
        {
            using var img = new Image<Rgba32>(width, height);
            img.ProcessPixelRows(accessor =>
            {
                for (int y = 0; y < accessor.Height; y++)
                {
                    var row = accessor.GetRowSpan(y);
                    for (int x = 0; x < row.Length; x++)
                    {
                        row[x] = new Rgba32((byte)(x % 256), (byte)(y % 256), 200, 255);
                    }
                }
            });
            using var ms = new MemoryStream();
            img.SaveAsPng(ms);
            return ms.ToArray();
        }

        [Fact]
        public async Task Process_ResizesJpeg_AboveMaxDimension()
        {
            var bytes = MakeJpeg(3000, 2000);
            using var ms = new MemoryStream(bytes);
            var result = await _processor.ProcessAsync(ms, ".jpg");

            Assert.True(result.Width <= ImageSharpProcessor.MaxDimension);
            Assert.True(result.Height <= ImageSharpProcessor.MaxDimension);
            Assert.Equal(ImageSharpProcessor.MaxDimension, result.Width); // большая сторона ровно 1920
        }

        [Fact]
        public async Task Process_KeepsSmallJpeg_Dimensions()
        {
            var bytes = MakeJpeg(400, 300);
            using var ms = new MemoryStream(bytes);
            var result = await _processor.ProcessAsync(ms, ".jpg");
            Assert.Equal(400, result.Width);
            Assert.Equal(300, result.Height);
        }

        [Fact]
        public async Task Process_LargeJpeg_BytesShrink()
        {
            var bytes = MakeJpeg(3000, 2000);
            using var ms = new MemoryStream(bytes);
            var result = await _processor.ProcessAsync(ms, ".jpg");

            // После resize 1920×1280 + JPEG q82 размер должен быть существенно меньше исходного q95@3000.
            Assert.True(result.Bytes.Length < bytes.Length,
                $"После сжатия должно стать меньше: было {bytes.Length}, стало {result.Bytes.Length}");
        }

        [Fact]
        public async Task Process_NormalizesJpegExtension_From_jpeg_to_jpg()
        {
            var bytes = MakeJpeg(800, 600);
            using var ms = new MemoryStream(bytes);
            var result = await _processor.ProcessAsync(ms, ".jpeg");
            Assert.Equal(".jpg", result.Extension);
            Assert.Equal("image/jpeg", result.ContentType);
        }

        [Fact]
        public async Task Process_PreservesPngFormat()
        {
            var bytes = MakePng(800, 600);
            using var ms = new MemoryStream(bytes);
            var result = await _processor.ProcessAsync(ms, ".png");
            Assert.Equal(".png", result.Extension);
            Assert.Equal("image/png", result.ContentType);
        }

        [Fact]
        public async Task Process_PassthroughForGif()
        {
            // Делаем "фейковый" GIF — фактически валидный 1-кадровый.
            using var img = new Image<Rgba32>(50, 50);
            using var origMs = new MemoryStream();
            img.SaveAsGif(origMs);
            var origBytes = origMs.ToArray();

            using var input = new MemoryStream(origBytes);
            var result = await _processor.ProcessAsync(input, ".gif");

            Assert.Equal(".gif", result.Extension);
            Assert.Equal("image/gif", result.ContentType);
            // Прошёл насквозь — байты идентичны
            Assert.Equal(origBytes, result.Bytes);
        }

        [Fact]
        public async Task Process_ThrowsForGarbageInput()
        {
            var garbage = new byte[] { 1, 2, 3, 4, 5 };
            using var ms = new MemoryStream(garbage);
            await Assert.ThrowsAnyAsync<System.Exception>(
                () => _processor.ProcessAsync(ms, ".jpg"));
        }
    }
}
