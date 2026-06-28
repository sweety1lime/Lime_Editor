using Microsoft.AspNetCore.Http;
using System.Security.Claims;

namespace Lime_Editor.Services
{
    // Текущий пользователь запроса — для EF global query filter изоляции тенантов.
    // UserId = null, когда запрос анонимный или нет HttpContext (фон/миграции/тесты данных) —
    // в этом случае фильтр в LimeEditorContext отключается (см. HasQueryFilter).
    public interface ICurrentUser
    {
        int? UserId { get; }
    }

    public sealed class CurrentUser : ICurrentUser
    {
        private readonly IHttpContextAccessor _accessor;

        public CurrentUser(IHttpContextAccessor accessor)
        {
            _accessor = accessor;
        }

        public int? UserId
        {
            get
            {
                var value = _accessor.HttpContext?.User?.FindFirstValue(ClaimTypes.NameIdentifier);
                return int.TryParse(value, out var id) ? id : (int?)null;
            }
        }
    }
}
