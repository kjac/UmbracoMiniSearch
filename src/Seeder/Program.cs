// See https://aka.ms/new-console-template for more information

using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Bogus.DataSets;

var lorem = new Lorem();
var commerce = new Commerce();
var internet = new Internet();
var client = new HttpClient
{
    BaseAddress = new Uri("http://localhost:3000"),
    DefaultRequestHeaders =
    {
        {"umb-webhook-event", "Umbraco.ContentPublish"}
    }
};
client.DefaultRequestHeaders.Authorization =
    new AuthenticationHeaderValue("Basic", Convert.ToBase64String("indexer:OjLAtxQXBKDxRK"u8.ToArray()));

for (var i = 0; i < 10000; i++)
{
    Console.CursorLeft = 0;
    Console.Write($"#{i}");
    var json = JsonSerializer.Serialize(
        // yes, the casing looks weird here, but this is how it has to be :) 
        new
        {
            Id = Guid.NewGuid(),
            Name = $"{commerce.ProductName()} - {commerce.Color()}",
            Route = new
            {
                Path = internet.UrlRootedPath()
            },
            Properties = new
            {
                tags = commerce.Categories(3).Distinct().ToArray(),
                excerpt = string.Join(" ", lorem.Words(50))
            }
        }
    );
    using StringContent jsonContent = new(json, Encoding.UTF8, "application/json");
    using HttpResponseMessage response = await client.PostAsync("/index", jsonContent);
    if (response.StatusCode != HttpStatusCode.OK)
    {
        var responseBody = await response.Content.ReadAsStringAsync();
        Console.WriteLine();
        Console.WriteLine($"ERROR: {response.StatusCode}, {responseBody}");
        return;
    }
}
