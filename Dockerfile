# syntax=docker/dockerfile:1.7

# ---------- Build stage ----------
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Слой restore кэшируется, пока csproj не меняется.
COPY Lime_Editor.sln ./
COPY Lime_Editor/Lime_Editor.csproj Lime_Editor/
RUN dotnet restore Lime_Editor/Lime_Editor.csproj

# Исходники
COPY Lime_Editor/ Lime_Editor/
RUN dotnet publish Lime_Editor/Lime_Editor.csproj \
    -c Release \
    -o /app/publish \
    --no-restore \
    /p:UseAppHost=false

# ---------- Runtime stage ----------
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# Запускаем под непривилегированным пользователем (есть в образе по умолчанию).
USER app

COPY --from=build --chown=app:app /app/publish ./

ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true

EXPOSE 8080

ENTRYPOINT ["dotnet", "Lime_Editor.dll"]
