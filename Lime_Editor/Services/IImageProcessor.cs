using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Lime_Editor.Services
{
    public sealed record ProcessedImage(byte[] Bytes, string Extension, string ContentType, int Width, int Height);

    public interface IImageProcessor
    {
        Task<ProcessedImage> ProcessAsync(Stream input, string originalExtension, CancellationToken ct = default);
    }
}
