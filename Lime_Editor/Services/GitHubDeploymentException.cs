using System;

namespace Lime_Editor.Services
{
    public sealed class GitHubDeploymentException : Exception
    {
        public GitHubDeploymentException(string code, string message)
            : base(message)
        {
            Code = code;
        }

        public string Code { get; }
    }
}
