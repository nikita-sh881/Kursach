"""Optional real demo catalog. Uses public APIs and never overwrites existing books."""
import getpass
import os
from datetime import datetime, timezone, timedelta
import httpx

SAMPLES = [
    ('Маленький принц', 'Антуан де Сент-Экзюпери', 'Философская проза', 'История о путешествии среди планет, дружбе, ответственности и внимании к тому, что действительно важно.'),
    ('Алиса в Стране чудес', 'Льюис Кэрролл', 'Приключения', 'Девочка попадает в необычный мир с загадками, парадоксами и удивительными персонажами. Сказочное путешествие и игра воображения.'),
    ('Машина времени', 'Герберт Уэллс', 'Научная фантастика', 'Изобретатель путешествует в далёкое будущее и исследует судьбу человечества. Научная фантастика о времени и социальных переменах.'),
    ('Гордость и предубеждение', 'Джейн Остин', 'Роман', 'Элизабет Беннет учится видеть людей за первым впечатлением. Роман о любви, семейных ожиданиях и независимости с тонким юмором.'),
    ('Белый Клык', 'Джек Лондон', 'Приключения', 'История волка-собаки среди суровой природы Севера и человеческого мира. Приключения, выживание, доверие и привязанность.'),
    ('Преступление и наказание', 'Фёдор Достоевский', 'Психологическая проза', 'Петербургский студент сталкивается с последствиями своего решения. Психологический роман о совести, вине и нравственном выборе.'),
    ('Вокруг света за восемьдесят дней', 'Жюль Верн', 'Приключения', 'Филеас Фогг отправляется в путешествие, чтобы выиграть пари. Приключенческая история о странах, открытиях, дружбе и решимости.'),
    ('Анна Каренина', 'Лев Толстой', 'Роман', 'Семейные отношения, любовь и общественные ожидания в России XIX века. Роман о личном выборе и поиске осмысленной жизни.'),
]

def main():
    email = input('Administrator/staff email: ').strip()
    password = getpass.getpass('Password: ')
    with httpx.Client(base_url=os.getenv('LIBRARY_URL', 'http://gateway'), timeout=30) as client:
        r = client.post('/auth/login', json={'email': email, 'password': password})
        r.raise_for_status()
        client.headers['Authorization'] = 'Bearer ' + r.json()['access_token']
        def named(kind, name):
            response = client.get('/catalog/' + kind)
            response.raise_for_status()
            for row in response.json():
                if row['name'] == name:
                    return row['id']
            response = client.post('/catalog/' + kind, json={'name': name})
            response.raise_for_status()
            return response.json()['id']
        for number, (title, author, genre, description) in enumerate(SAMPLES, start=1):
            aid, gid = named('authors', author), named('genres', genre)
            r = client.get('/catalog/books', params={'q': title, 'limit': 100})
            r.raise_for_status()
            book = next((b for b in r.json() if b['title'] == title), None)
            if not book:
                r = client.post('/catalog/books', json={'title': title, 'description': description, 'author_ids': [aid], 'genre_ids': [gid]})
                r.raise_for_status()
                book = r.json()
            r = client.post('/circulation/copies', json={'book_id': book['id'], 'barcode': f'DEMO-{number:03d}'})
            if r.status_code != 409:
                r.raise_for_status()
            print('Ready:', title)
        print('Building real neural index (first run downloads the model)...')
        r = client.post('/recommendations/reindex', timeout=300)
        r.raise_for_status()
        print('Indexed:', r.json()['indexed'])

if __name__ == '__main__':
    main()
