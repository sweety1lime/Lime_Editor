namespace Lime_Editor.Models
{
    // Тип владельца подписки/потребления (этап 3.4). Сейчас всегда User;
    // Workspace заводит почву под командную работу (Wave 3) без переписывания схемы.
    public enum OwnerKind : byte
    {
        User = 0,
        Workspace = 1,
    }

    // Ссылка на владельца тарифа. Единая точка: вся биллинг-логика оперирует OwnerRef,
    // а не голым userId — когда появятся команды, поменяется только маппинг.
    public readonly struct OwnerRef
    {
        public OwnerKind Kind { get; }
        public int Id { get; }

        public OwnerRef(OwnerKind kind, int id)
        {
            Kind = kind;
            Id = id;
        }

        public static OwnerRef ForUser(int userId) => new(OwnerKind.User, userId);
    }
}
